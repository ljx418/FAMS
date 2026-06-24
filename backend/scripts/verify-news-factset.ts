import assert from 'node:assert/strict'
import { newsDataProvider } from '../src/services/technical/newsDataProvider.js'
import { stockAnalysisService } from '../src/services/technical/stockAnalysisService.js'

const snapshot = await newsDataProvider.getEastmoneyNewsSnapshot('601127', '赛力斯')
assert.equal(snapshot.provider, 'eastmoney_search')
assert.equal(snapshot.quality, 'ok', snapshot.warnings.join('; '))
assert.ok(snapshot.events.length > 0, 'news events should be present')
assert.ok(snapshot.events[0].title, 'news title should be present')
assert.ok(snapshot.events[0].publishedAt, 'news publishedAt should be present')
assert.ok(['positive', 'neutral', 'negative'].includes(snapshot.events[0].sentiment))

const analysis = await stockAnalysisService.getFullAnalysis('601127', 'A股', 80)
assert.equal(analysis.factSet.news.quality, 'ok')
assert.ok(analysis.factSet.news.facts.length > 0)
assert.ok(analysis.newsSnapshot.events.length > 0)

console.log(JSON.stringify({
  ok: true,
  provider: snapshot.providerLabel,
  eventCount: snapshot.events.length,
  firstEvent: {
    title: snapshot.events[0].title,
    source: snapshot.events[0].source,
    publishedAt: snapshot.events[0].publishedAt,
    eventType: snapshot.events[0].eventType,
    sentiment: snapshot.events[0].sentiment,
  },
  factSetNewsQuality: analysis.factSet.news.quality,
  factSetNewsFacts: analysis.factSet.news.facts.length,
}, null, 2))
