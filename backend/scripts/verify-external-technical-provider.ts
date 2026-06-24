import assert from 'node:assert/strict'
import { externalTechnicalDataProvider } from '../src/services/technical/externalTechnicalDataProvider.js'

const snapshot = await externalTechnicalDataProvider.getTradingViewTechnicalSnapshot('601127', 'A股')

assert.equal(snapshot.provider, 'tradingview')
assert.equal(snapshot.quality, 'ok', snapshot.warnings.join('; '))
assert.ok(snapshot.providerSymbol?.startsWith('SSE:'), '601127 should resolve to SSE')
assert.ok(snapshot.rating, 'TradingView rating should be present')
assert.ok(typeof snapshot.indicators.rsi14 === 'number', 'external RSI14 should be present')
assert.ok(typeof snapshot.indicators.sma20 === 'number', 'external SMA20 should be present')
assert.ok(snapshot.confidence.score >= 60, 'provider-only confidence should be at least medium')

console.log(JSON.stringify({
  ok: true,
  provider: snapshot.providerLabel,
  symbol: snapshot.providerSymbol,
  rating: snapshot.rating,
  confidence: snapshot.confidence,
  rsi14: snapshot.indicators.rsi14,
  sma20: snapshot.indicators.sma20,
  asOf: snapshot.asOf,
}, null, 2))
