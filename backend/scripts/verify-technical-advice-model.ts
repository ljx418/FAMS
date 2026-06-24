import assert from 'node:assert/strict'
import { technicalAdviceModelRegistry } from '../src/services/technical/technicalAdviceModelRegistry.js'
import type { ExternalTechnicalSnapshot } from '../src/services/technical/externalTechnicalDataProvider.js'

const highConfidenceSnapshot: ExternalTechnicalSnapshot = {
  provider: 'tradingview',
  providerLabel: 'TradingView Scanner',
  providerSymbol: 'SSE:601127',
  sourceUrl: 'https://scanner.tradingview.com/china/scan',
  asOf: new Date().toISOString(),
  quality: 'ok',
  model: {
    name: 'TradingView Technical Ratings',
    version: 'test',
    description: 'test',
  },
  rating: {
    allScore: -0.52,
    maScore: -0.9,
    oscillatorScore: -0.08,
    all: '强烈卖出',
    ma: '强烈卖出',
    oscillator: '中性',
  },
  indicators: {
    close: 81.8,
    rsi14: 29.17,
    macd: -2.43,
    macdSignal: -2.0,
    macdHistogram: -0.43,
    sma20: 88.65,
  },
  confidence: {
    score: 95,
    level: 'high',
    sourceCount: 2,
    checks: [
      { name: 'tradingview_response', status: 'pass', detail: 'ok' },
      { name: 'close_cross_source', status: 'pass', detail: 'ok' },
    ],
  },
  warnings: [],
}

const advice = technicalAdviceModelRegistry.evaluateTradingViewRatings(highConfidenceSnapshot)
assert.equal(advice.status, 'available')
assert.equal(advice.stance, 'defensive')
assert.ok(advice.evidence.length >= 5)
assert.equal(advice.blockedReasons.length, 0)

const lowConfidenceAdvice = technicalAdviceModelRegistry.evaluateTradingViewRatings({
  ...highConfidenceSnapshot,
  confidence: {
    score: 55,
    level: 'low',
    sourceCount: 1,
    checks: [{ name: 'close_cross_source', status: 'fail', detail: 'bad' }],
  },
})
assert.equal(lowConfidenceAdvice.status, 'blocked')
assert.ok(lowConfidenceAdvice.blockedReasons.some((reason) => reason.includes('低于门槛')))

console.log(JSON.stringify({
  ok: true,
  available: {
    status: advice.status,
    stance: advice.stance,
    summary: advice.summary,
    evidenceCount: advice.evidence.length,
  },
  blocked: {
    status: lowConfidenceAdvice.status,
    blockedReasons: lowConfidenceAdvice.blockedReasons,
  },
}, null, 2))
