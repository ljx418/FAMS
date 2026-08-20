import assert from 'node:assert/strict'
import { buildStockMarketTrendSnapshot } from '../src/services/technical/stockMarketTrendService.js'
import type { StockHistoryData, StockRealtimeData } from '../src/utils/stockUtils.js'

const start = new Date('2026-05-01T00:00:00.000Z')
const history: StockHistoryData[] = Array.from({ length: 80 }, (_, index) => {
  const date = new Date(start)
  date.setUTCDate(start.getUTCDate() + index)
  const close = 40 + index * 0.1
  return {
    date: date.toISOString().slice(0, 10),
    open: close - 0.1,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 1_000_000 + index,
    source: 'test_history',
  }
})

// Add an intraday bar. At 10:00 China time it must not enter the close series or MA calculation.
history.push({
  date: '2026-08-20',
  open: 60,
  high: 61,
  low: 59,
  close: 60.5,
  volume: 500_000,
  source: 'test_history',
})

const realtime: StockRealtimeData = {
  symbol: 'TEST',
  name: '测试标的',
  price: 60.6,
  priceChange: 1.2,
  priceChangePercent: 2.02,
  timestamp: new Date('2026-08-20T02:00:00.000Z'),
  source: 'test_realtime',
}

const snapshot = buildStockMarketTrendSnapshot({
  symbol: 'TEST',
  requestedTradingDays: 30,
  history,
  realtime,
  now: new Date('2026-08-20T02:00:00.000Z'),
})

const completed = history
  .filter((row) => row.date < '2026-08-20')
  .sort((a, b) => a.date.localeCompare(b.date))
const average = (period: number) => completed.slice(-period).reduce((sum, row) => sum + row.close, 0) / period

assert.equal(snapshot.schemaVersion, 'stock.market-trend.v1')
assert.equal(snapshot.quote.price, 60.6)
assert.equal(snapshot.quote.sessionStatus, 'intraday')
assert.equal(snapshot.quote.fallbackUsed, false)
assert.equal(snapshot.latestClose.date, completed.at(-1)?.date)
assert.equal(snapshot.recentCloses.length, 30)
assert.equal(snapshot.recentCloses.at(-1)?.date, completed.at(-1)?.date)
assert.ok(snapshot.recentCloses.every((row) => row.date !== '2026-08-20'))
assert.equal(snapshot.indicators.ma5, Math.round(average(5) * 10_000) / 10_000)
assert.equal(snapshot.indicators.ma10, Math.round(average(10) * 10_000) / 10_000)
assert.equal(snapshot.indicators.ma30, Math.round(average(30) * 10_000) / 10_000)
assert.ok(snapshot.history.length >= 30)
assert.ok(snapshot.warnings.some((warning) => warning.includes('排除当日盘中K线')))

console.log(JSON.stringify({
  ok: true,
  latestClose: snapshot.latestClose,
  quote: snapshot.quote,
  indicators: snapshot.indicators,
  recentCloseCount: snapshot.recentCloses.length,
}, null, 2))
