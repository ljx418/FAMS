import { execFile } from 'node:child_process'
import { URLSearchParams } from 'node:url'

export type NewsQuality = 'ok' | 'provider_failed' | 'missing_data'
export type NewsSentiment = 'positive' | 'neutral' | 'negative'

export interface NewsEvent {
  id: string
  title: string
  summary: string
  source: string
  publishedAt: string
  url: string
  eventType: string
  sentiment: NewsSentiment
  relevance: number
}

export interface NewsSnapshot {
  provider: 'eastmoney_search'
  providerLabel: string
  sourceUrl: string
  asOf: string
  quality: NewsQuality
  events: NewsEvent[]
  warnings: string[]
}

interface EastmoneySearchArticle {
  code?: string
  title?: string
  content?: string
  mediaName?: string
  date?: string
  url?: string
}

function curlText(url: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-L', '-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Referer: https://so.eastmoney.com/', '-H', 'User-Agent: Mozilla/5.0', url],
      { maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolve(stdout)
      }
    )
  })
}

function parseJsonp<T>(text: string): T {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start < 0 || end <= start) throw new Error(`JSONP parse failed: ${text.slice(0, 120)}`)
  return JSON.parse(text.slice(start + 1, end)) as T
}

function classifyEvent(title: string, summary: string) {
  const text = `${title} ${summary}`
  if (/季报|年报|半年报|财报|净利润|营收|业绩/.test(text)) return 'financial_report'
  if (/诉讼|起诉|判赔|监管|处罚|立案/.test(text)) return 'legal_regulatory'
  if (/机构|持股|股东|减持|增持/.test(text)) return 'shareholder_institution'
  if (/主力资金|资金流|净流入|净流出/.test(text)) return 'capital_flow'
  if (/订单|合同|中标|合作|产品|发布/.test(text)) return 'business_operation'
  return 'general_news'
}

function classifySentiment(title: string, summary: string): NewsSentiment {
  const text = `${title} ${summary}`
  if (/净流出|减少|减持|起诉|判赔|处罚|立案|下滑|亏损|风险|终止/.test(text)) return 'negative'
  if (/增长|增持|回购|中标|突破|创新高|净流入|盈利|改善/.test(text)) return 'positive'
  return 'neutral'
}

function toIso(dateText?: string) {
  if (!dateText) return new Date().toISOString()
  const parsed = new Date(dateText.replace(/-/g, '/'))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
}

class NewsDataProvider {
  async getEastmoneyNewsSnapshot(code: string, name?: string): Promise<NewsSnapshot> {
    const sourceUrl = 'https://search-api-web.eastmoney.com/search/jsonp'
    const keyword = name ? `${code} ${name}` : code
    const params = new URLSearchParams({
      cb: 'jQuery',
      param: JSON.stringify({
        uid: '',
        keyword,
        type: ['cmsArticleWebOld'],
        client: 'web',
        clientType: 'web',
        clientVersion: 'curr',
        param: {
          cmsArticleWebOld: {
            searchScope: 'default',
            sort: 'default',
            pageIndex: 1,
            pageSize: 8,
            preTag: '',
            postTag: '',
          },
        },
      }),
    })

    try {
      const raw = await curlText(`${sourceUrl}?${params.toString()}`)
      const parsed = parseJsonp<{
        code?: number
        result?: { cmsArticleWebOld?: EastmoneySearchArticle[] }
      }>(raw)
      const rows = parsed.result?.cmsArticleWebOld || []
      const events = rows
        .filter((row) => row.title && row.url && row.date)
        .map((row, index) => {
          const title = row.title || ''
          const summary = row.content || ''
          return {
            id: row.code || `eastmoney_news_${index}`,
            title,
            summary,
            source: row.mediaName || '东方财富搜索',
            publishedAt: toIso(row.date),
            url: row.url || '',
            eventType: classifyEvent(title, summary),
            sentiment: classifySentiment(title, summary),
            relevance: title.includes(code) || summary.includes(code) || (name && (title.includes(name) || summary.includes(name))) ? 90 : 70,
          } satisfies NewsEvent
        })
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

      return {
        provider: 'eastmoney_search',
        providerLabel: 'Eastmoney Search News',
        sourceUrl,
        asOf: new Date().toISOString(),
        quality: events.length > 0 ? 'ok' : 'missing_data',
        events,
        warnings: events.length > 0 ? [] : [`东方财富搜索未返回 ${keyword} 相关新闻。`],
      }
    } catch (error) {
      return {
        provider: 'eastmoney_search',
        providerLabel: 'Eastmoney Search News',
        sourceUrl,
        asOf: new Date().toISOString(),
        quality: 'provider_failed',
        events: [],
        warnings: [`东方财富新闻搜索失败：${error instanceof Error ? error.message : String(error)}`],
      }
    }
  }
}

export const newsDataProvider = new NewsDataProvider()
