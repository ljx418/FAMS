import assert from 'node:assert/strict'
import { technicalIndicatorService, type TechnicalBar } from '../src/services/technical/technicalIndicatorService.js'

function buildBars(count: number): TechnicalBar[] {
  const start = new Date('2026-01-01T15:00:00.000Z')
  return Array.from({ length: count }, (_, index) => {
    const close = 10 + index * 0.2 + Math.sin(index / 3) * 0.1
    return {
      timestamp: new Date(start.getTime() + index * 24 * 60 * 60 * 1000),
      openPrice: close - 0.05,
      highPrice: close + 0.2,
      lowPrice: close - 0.2,
      closePrice: close,
      volume: 1000000 + index * 10000,
      source: 'synthetic',
    }
  })
}

const duplicatedBars: TechnicalBar[] = [
  ...buildBars(3),
  {
    timestamp: new Date('2026-01-03T16:00:00.000Z'),
    closePrice: 12,
    highPrice: 12.2,
    lowPrice: 11.8,
    volume: 1300000,
    source: 'synthetic_late',
  },
]
const normalized = technicalIndicatorService.normalizeBars(duplicatedBars)
assert.equal(normalized.length, 3, 'same-day duplicated rows should be collapsed')
assert.equal(normalized[2].closePrice, 12, 'same-day dedupe should keep the latest row')

const insufficient = technicalIndicatorService.buildSnapshotFromBars({
  symbol: 'TEST',
  bars: buildBars(3),
})
assert.equal(insufficient.quality, 'insufficient_data')
assert.equal(insufficient.indicators.rsi14.quality, 'insufficient_data')
assert.equal(technicalIndicatorService.buildTradingSignals(insufficient).length, 0, 'insufficient samples must not produce signals')

const snapshot = technicalIndicatorService.buildSnapshotFromBars({
  symbol: 'TEST',
  bars: buildBars(80),
})
assert.equal(snapshot.schemaVersion, 'technical.indicators.v1')
assert.equal(snapshot.quality, 'ok')
assert.equal(snapshot.rawSampleCount, 80)
assert.equal(snapshot.sampleCount, 80)
assert.equal(snapshot.indicators.ma20.quality, 'ok')
assert.equal(snapshot.indicators.rsi14.quality, 'ok')
assert.equal(snapshot.indicators.macd.quality, 'ok')
assert.equal(snapshot.indicators.boll20.quality, 'ok')
assert.equal(snapshot.indicators.atr14.quality, 'ok')
assert.ok(typeof snapshot.indicators.rsi14.value === 'number')
assert.ok((snapshot.indicators.rsi14.value || 0) >= 0 && (snapshot.indicators.rsi14.value || 0) <= 100)
assert.ok(snapshot.indicators.supportResistance20.value?.support)
assert.ok(snapshot.indicators.supportResistance20.value?.resistance)
assert.equal(
  technicalIndicatorService.buildTradingSignals(snapshot).length,
  0,
  'local FAMS indicators are audit facts only and must not produce trading advice'
)

console.log(JSON.stringify({
  ok: true,
  insufficientQuality: insufficient.quality,
  sampleCount: snapshot.sampleCount,
  rsi14: snapshot.indicators.rsi14.value,
  macd: snapshot.indicators.macd.value,
  signalCount: technicalIndicatorService.buildTradingSignals(snapshot).length,
}, null, 2))
