/**
 * Fund Utils - 基金数据获取工具
 *
 * 职责：封装基金相关数据获取逻辑，从天天基金、东方财富等获取真实数据
 */

import axios from 'axios'
import { compactHttpError } from './httpJson.js'

export interface FundRealtimeData {
  fundcode: string
  name: string
  price: number
  priceChange: number
  priceChangePercent: number
  gztime: string
  source: string
}

export interface FundHistoryRecord {
  date: string
  nav: number
  navChange: number
  navChangePercent: number
}

export interface FundHolding {
  stockCode: string
  stockName: string
  shares: number
  marketValue: number
  proportion: number
}

export interface FundHoldingsData {
  fundCode: string
  fundName: string
  reportDate: string
  holdings: FundHolding[]
}

/**
 * 获取基金实时估值
 * 数据来源：天天基金网
 */
export async function getFundRealtime(fundCode: string): Promise<FundRealtimeData | null> {
  try {
    const timestamp = Date.now()
    const response = await axios.get(
      `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${timestamp}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        timeout: 10000,
      }
    )

    // 天天基金返回格式: jsonpgz({"fundcode":"000001",...})
    const dataStr: string = response.data
    const jsonMatch = dataStr.match(/jsonpgz\((.+)\)/)

    if (!jsonMatch) return null

    const data = JSON.parse(jsonMatch[1])

    // gsz 是实时估值，jz 是净值（可能是昨日）
    const price = parseFloat(data.gsz) || parseFloat(data.jz) || 0
    const gztime = data.gztime || ''
    const dwjz = parseFloat(data.dwjz) || 0

    let priceChange = 0
    let priceChangePercent = 0
    if (dwjz && price) {
      priceChange = price - dwjz
      priceChangePercent = (priceChange / dwjz) * 100
    }

    return {
      fundcode: data.fundcode || fundCode,
      name: data.name || fundCode,
      price,
      priceChange,
      priceChangePercent,
      gztime,
      source: 'tiantian',
    }
  } catch (error) {
    console.error(`Failed to fetch fund realtime for ${fundCode}:`, compactHttpError(error))
    return null
  }
}

/**
 * 获取基金历史净值
 * 数据来源：东方财富
 */
export async function getFundHistory(
  fundCode: string,
  period: '1M' | '6M' | '1Y' | '3Y' = '1M'
): Promise<{ fundCode: string; fundName: string; records: FundHistoryRecord[] }> {
  const daysMap = { '1M': 30, '6M': 180, '1Y': 365, '3Y': 1095 }
  const days = daysMap[period]

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const startDateStr = startDate.toISOString().split('T')[0]  // YYYY-MM-DD
  const endDateStr = endDate.toISOString().split('T')[0]       // YYYY-MM-DD

  const fundInfo = await getFundRealtime(fundCode)
  const fundName = fundInfo?.name || fundCode

  const records: FundHistoryRecord[] = []

  try {
    let pageIndex = 1
    const pageSize = 200  // 每次取200条减少请求次数
    let totalCount = Infinity

    while (records.length < totalCount) {
      const resp = await axios.get(
        `https://api.fund.eastmoney.com/f10/lsjz`,
        {
          params: {
            fundCode,
            pageIndex,
            pageSize,
            startDate: startDateStr,
            endDate: endDateStr,
          },
          headers: { Referer: 'https://fund.eastmoney.com/' },
          timeout: 15000,
        }
      )

      const respData = resp.data
      const listData = respData?.Data
      if (!listData?.LSJZList || listData.LSJZList.length === 0) break

      // 第一次请求时获取总量
      if (pageIndex === 1) {
        totalCount = respData.TotalCount || listData.LSJZList.length
      }

      for (const item of listData.LSJZList) {
        records.push({
          date: item.FSRQ,
          nav: parseFloat(item.DWJZ),
          navChange: parseFloat(item.JZZZL) || 0,
          navChangePercent: parseFloat(item.JZZZL) || 0,
        })
      }

      pageIndex++

      // 安全上限防止无限循环
      if (pageIndex > 20) break
    }
  } catch (error) {
    console.error(`Failed to fetch fund history for ${fundCode}:`, compactHttpError(error))
  }

  // 按日期排序（从早到晚）
  records.sort((a, b) => a.date.localeCompare(b.date))

  return { fundCode, fundName, records }
}

/**
 * 获取基金持仓明细
 * 数据来源：东方财富
 */
export async function getFundHoldings(fundCode: string): Promise<FundHoldingsData> {
  const fundInfo = await getFundRealtime(fundCode)
  const fundName = fundInfo?.name || fundCode

  try {
    const resp = await axios.get(
      `https://fundf10.eastmoney.com/FundArchivesDatas.aspx`,
      {
        params: {
          type: 'jjcc',
          code: fundCode,
          topLine: 10,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://fundf10.eastmoney.com/',
        },
        timeout: 10000,
      }
    )

    const html = resp.data as string

    // 提取报告日期
    const dateMatch = html.match(/截止至：<font class='px12'>(\d{4}-\d{2}-\d{2})<\/font>/)
    const reportDate = dateMatch ? dateMatch[1] : ''

    // 解析持仓表格
    // 行结构: <td><a href='...'>股票代码</a></td><td class='tol'><a ...>股票名称</a></td>
    //         <td class='tor'><span data-id='dq...'></span></td>  // 现价(空)
    //         <td class='tor'><span data-id='zd...'></span></td>  // 涨跌(空)
    //         <td class='xglj'>...链接...</td>
    //         <td class='tor'>比例%</td><td class='tor'>持股数</td><td class='tor'>市值</td>
    const holdings: FundHolding[] = []
    const holdingRegex = /<td><a href='[^']+'>\s*(\d{6})\s*<\/a><\/td><td class='tol'><a href='[^']+'>(.*?)<\/a><\/td>[\s\S]*?<td class='tor'>([\d.]+)%<\/td><td class='tor'>([\d,.]+)<\/td><td class='tor'>([\d,.]+)<\/td>/g
    let match

    while ((match = holdingRegex.exec(html)) !== null) {
      holdings.push({
        stockCode: match[1],
        stockName: match[2].trim(),
        shares: parseFloat(match[4].replace(/,/g, '')) || 0,
        marketValue: parseFloat(match[5].replace(/,/g, '')) || 0,
        proportion: parseFloat(match[3]) || 0,
      })
    }

    return { fundCode, fundName, reportDate, holdings }
  } catch (error) {
    console.error(`Failed to fetch fund holdings for ${fundCode}:`, compactHttpError(error))
    return { fundCode, fundName, reportDate: '', holdings: [] }
  }
}

/**
 * 获取基金持仓股票的实时价格
 * 数据来源：新浪财经（东方财富 push2 接口在服务器环境受限）
 */
export async function getHoldingStockRealtime(
  stockCode: string
): Promise<{ price: number; priceChange: number; priceChangePercent: number }> {
  try {
    const prefix = stockCode.startsWith('6') ? 'sh' : 'sz'
    const response = await axios.get(
      `https://hq.sinajs.cn/list=${prefix}${stockCode}`,
      {
        headers: {
          Referer: 'https://finance.sina.com.cn/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      }
    )

    // 格式: var hq_str_sh600276="名称,今日开盘,昨日收盘,当前价格,最高,最低,...
    // 索引:         0        1         2         3       4   5
    const dataStr: string = response.data
    const match = dataStr.match(/"([^"]+)"/)

    if (!match) {
      return { price: 0, priceChange: 0, priceChangePercent: 0 }
    }

    const fields = match[1].split(',')
    const price = parseFloat(fields[3]) || 0
    const yesterdayClose = parseFloat(fields[2]) || 0
    const priceChange = price - yesterdayClose
    const priceChangePercent = yesterdayClose > 0 ? (priceChange / yesterdayClose) * 100 : 0

    return { price, priceChange, priceChangePercent }
    } catch (error) {
      console.error(`Failed to fetch holding stock realtime for ${stockCode}:`, compactHttpError(error))
    return { price: 0, priceChange: 0, priceChangePercent: 0 }
  }
}

/**
 * 查找持有指定股票的基金列表
 * 数据来源：东方财富基金持仓页面
 * @param stockCode 股票代码（如 600276）
 * @param topN 返回数量，默认10
 */
export async function getFundsHoldingStock(
  stockCode: string,
  topN: number = 10
): Promise<Array<{
  fundCode: string
  fundName: string
  reportDate: string
  proportion: number  // 该股票占基金净值比例
}>> {
  // 东方财富有一个接口可以搜索基金持股情况
  // 尝试使用 EastMoney 数据中心接口
  try {
    const resp = await axios.get(
      `https://datacenter.eastmoney.com/securities/api/data/v1/get`,
      {
        params: {
          reportName: 'RPT_MUTUAL_FUND_STOCK',
          columns: 'FUND_CODE,FUND_SHORTNAME,SECUCODE,PUBLISH_DATE,HOLD_MARKET_CAP,HOLD_RATIO',
          filter: `(SECUCODE like '%${stockCode}%')`,
          pageNumber: 1,
          pageSize: topN,
          sortTypes: -1,
          sortColumns: 'PUBLISH_DATE',
          source: 'HSF10',
          client: 'HSF10',
        },
        headers: {
          Referer: 'https://data.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      }
    )

    const result = resp.data?.result
    if (!result?.data?.length) return []

    return result.data.map((item: any) => ({
      fundCode: item.FUND_CODE || item.SECUCODE?.substring(0, 6),
      fundName: item.FUND_SHORTNAME || '',
      reportDate: item.PUBLISH_DATE || '',
      proportion: parseFloat(item.HOLD_RATIO) || 0,
    }))
  } catch {
    return []
  }
}

/**
 * 批量获取基金的净值走势（用于在股票详情中展示相关基金走势）
 * @param fundCodes 基金代码列表
 * @param period 时间段
 */
export async function getFundsTrend(
  fundCodes: string[],
  period: '1M' | '6M' | '1Y' | '3Y' = '1M'
): Promise<Record<string, { fundCode: string; fundName: string; records: FundHistoryRecord[]; changePercent: number }>> {
  const results: Record<string, any> = {}

  await Promise.allSettled(
    fundCodes.slice(0, 5).map(async (code) => {
      const history = await getFundHistory(code, period)
      const changePercent = history.records.length >= 2
        ? ((history.records[history.records.length - 1].nav - history.records[0].nav) / history.records[0].nav) * 100
        : 0
      results[code] = {
        fundCode: code,
        fundName: history.fundName,
        records: history.records,
        changePercent,
      }
    })
  )

  return results
}
