import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

type Position = {
  quantity: number
  currentPrice: number
  marketValue: number
  costBasis: number
  unrealizedPnl: number
  asset: {
    symbol: string
    name: string
    type: string
  }
}

type PositionsResponse = {
  data: Position[]
}

type EastmoneyNav = {
  source: 'eastmoney_nav'
  nav: number
  date: string
  changePercent: number
}

type TiantianQuote = {
  source: 'tiantian'
  name: string
  officialNav: number | null
  officialDate: string | null
  estimateNav: number | null
  estimateTime: string | null
}

async function curl(url: string, headers: string[] = []) {
  const args = ['-L', '--max-time', '12', '-sS']
  for (const header of headers) args.push('-H', header)
  args.push(url)
  const { stdout } = await execFileAsync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  return stdout
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`)
  assert.equal(response.ok, true, `${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

async function fetchEastmoneyNav(symbol: string): Promise<EastmoneyNav | null> {
  const text = await curl(
    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${symbol}&pageIndex=1&pageSize=1`,
    ['Referer: https://fund.eastmoney.com/', 'User-Agent: curl/8.5.0'],
  )
  const body = JSON.parse(text)
  const latest = body?.Data?.LSJZList?.[0]
  if (!latest?.DWJZ || !latest?.FSRQ) return null
  return {
    source: 'eastmoney_nav',
    nav: Number(latest.DWJZ),
    date: latest.FSRQ,
    changePercent: Number(latest.JZZZL) || 0,
  }
}

async function fetchTiantianQuote(symbol: string): Promise<TiantianQuote | null> {
  const text = await curl(
    `https://fundgz.1234567.com.cn/js/${symbol}.js?rt=${Date.now()}`,
    ['User-Agent: curl/8.5.0'],
  )
  const match = text.match(/jsonpgz\((.+)\)/)
  if (!match) return null
  const data = JSON.parse(match[1])
  return {
    source: 'tiantian',
    name: data.name,
    officialNav: data.dwjz ? Number(data.dwjz) : null,
    officialDate: data.jzrq || null,
    estimateNav: data.gsz ? Number(data.gsz) : null,
    estimateTime: data.gztime || null,
  }
}

function assertClose(actual: number, expected: number, message: string, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`)
}

async function main() {
  const positions = await fetchJson<PositionsResponse>(`/api/v1/positions?userId=${encodeURIComponent(userId)}&status=open&limit=500`)
  const fundPositions = positions.data.filter((position) => position.asset.type === 'fund' || position.asset.type === 'bond')
  assert.ok(fundPositions.length > 0, 'No fund/bond positions found')

  const rows = []
  for (const position of fundPositions) {
    const [eastmoney, tiantian] = await Promise.all([
      fetchEastmoneyNav(position.asset.symbol),
      fetchTiantianQuote(position.asset.symbol).catch(() => null),
    ])
    assert.ok(eastmoney, `${position.asset.symbol} should have Eastmoney official NAV`)
    assertClose(position.currentPrice, eastmoney.nav, `${position.asset.symbol} currentPrice should use Eastmoney official NAV`)
    assertClose(position.marketValue, position.quantity * position.currentPrice, `${position.asset.symbol} marketValue should equal quantity × currentPrice`, 0.02)
    assertClose(position.unrealizedPnl, position.marketValue - position.costBasis, `${position.asset.symbol} unrealizedPnl should equal marketValue - costBasis`, 0.02)

    rows.push({
      symbol: position.asset.symbol,
      name: tiantian?.name || position.asset.name,
      systemNav: position.currentPrice,
      eastmoneyNav: eastmoney.nav,
      eastmoneyDate: eastmoney.date,
      tiantianOfficialNav: tiantian?.officialNav ?? null,
      tiantianOfficialDate: tiantian?.officialDate ?? null,
      tiantianEstimateNav: tiantian?.estimateNav ?? null,
      tiantianEstimateTime: tiantian?.estimateTime ?? null,
      estimateMinusOfficial: tiantian?.estimateNav != null ? Number((tiantian.estimateNav - eastmoney.nav).toFixed(6)) : null,
    })
  }

  console.table(rows)
  console.log(JSON.stringify({ ok: true, checked: rows.length, rows }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
