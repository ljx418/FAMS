import assert from 'node:assert/strict'
import {
  cnIndustryRotationPreset,
  hkIndustryRotationPreset,
  industryRotationPresetChoices,
} from '../frontend/src/components/relative-rotation/industryRotationPresets.js'
import { buildIndustryRotationAnalysis } from '../frontend/src/components/relative-rotation/industryRotationAnalysis.js'
import type {
  RotationPoint,
  RotationQuadrant,
  RotationResearchTimelineItem,
} from '../frontend/src/services/relativeRotationService.js'

const isoDate = (index: number) => {
  const date = new Date('2026-01-02T00:00:00.000Z')
  date.setUTCDate(date.getUTCDate() + (index * 7))
  return date.toISOString().slice(0, 10)
}

const points = (
  quadrant: RotationQuadrant,
  relativePriceFor: (index: number) => number,
): RotationPoint[] => Array.from({ length: 20 }, (_, index) => ({
  date: isoDate(index),
  relativePrice: relativePriceFor(index),
  relativeTrend: quadrant === 'leading' ? 101 + (index * 0.04) : 99 - (index * 0.04),
  relativeMomentum: quadrant === 'leading' ? 100.5 + (index * 0.03) : 99.5 - (index * 0.03),
  quadrant,
  deltaX: index === 0 ? null : quadrant === 'leading' ? 0.04 : -0.04,
  deltaY: index === 0 ? null : quadrant === 'leading' ? 0.03 : -0.03,
  speed: index === 0 ? null : 0.05,
}))

const timelineItem = (targetKey: string, name: string, series: RotationPoint[]): RotationResearchTimelineItem => ({
  targetKey,
  market: 'CN',
  sources: ['research'],
  positionId: null,
  assetId: null,
  watchlistItemId: null,
  deletable: false,
  symbol: targetKey.split(':').pop() || targetKey,
  name,
  assetType: 'etf',
  targetType: 'equity',
  isCurrentHolding: false,
  taxonomy: null,
  dataStatus: 'ready',
  readiness: 'verified',
  freshness: 'fresh',
  freshnessLag: 0,
  assetAsOfDate: series[series.length - 1].date,
  coveragePercent: 100,
  sampleDays: 300,
  benchmarkSampleDays: 300,
  firstPointDate: series[0].date,
  lastPointDate: series[series.length - 1].date,
  commonAsOfDate: series[series.length - 1].date,
  refreshedAt: null,
  sourceProviders: ['fixture'],
  points: series,
  blockers: [],
  warnings: [],
})

function verifyPresetIsolation() {
  assert.equal(industryRotationPresetChoices.length, 2)
  assert.equal(cnIndustryRotationPreset.market, 'CN')
  assert.equal(hkIndustryRotationPreset.market, 'HK')
  assert.equal(cnIndustryRotationPreset.targets.length, 15)
  assert.equal(hkIndustryRotationPreset.targets.length, 7)
  assert.ok(cnIndustryRotationPreset.targets.length <= 16)
  assert.ok(hkIndustryRotationPreset.targets.length <= 16)
  assert.ok(cnIndustryRotationPreset.targets.every((target) => target.targetKey?.startsWith('CN:equity:')))
  assert.ok(hkIndustryRotationPreset.targets.every((target) => target.targetKey?.startsWith('HK:equity:')))
  assert.equal(new Set(cnIndustryRotationPreset.targets.map((target) => target.targetKey)).size, cnIndustryRotationPreset.targets.length)
  assert.equal(new Set(hkIndustryRotationPreset.targets.map((target) => target.targetKey)).size, hkIndustryRotationPreset.targets.length)
  for (const preset of [cnIndustryRotationPreset, hkIndustryRotationPreset]) {
    assert.equal(preset.frequency, 'weekly')
    assert.equal(preset.historyYears, 8)
    assert.deepEqual(preset.period, { mode: 'rolling', rollingWeeks: 104 })
    assert.deepEqual(preset.benchmark, { mode: 'market_default', targetKeys: [] })
    assert.equal(preset.comparisonTargetKeys.length, 2)
    assert.ok(preset.comparisonTargetKeys.every((key) => preset.targets.some((target) => target.targetKey === key)))
  }
}

function verifyHistoricalAnalysis() {
  const endDate = isoDate(16)
  const analysis = buildIndustryRotationAnalysis([
    timelineItem('CN:equity:ALPHA', '行业甲', points('leading', (index) => 100 + index)),
    timelineItem('CN:equity:BETA', '行业乙', points('leading', (index) => 120 + (index * 1.2))),
    timelineItem('CN:equity:GAMMA', '行业丙', points('lagging', (index) => 120 - index)),
  ], endDate, 'weekly')

  assert.equal(analysis.asOfDate, endDate)
  assert.deepEqual(analysis.currentDistribution, { leading: 2, improving: 0, weakening: 0, lagging: 1 })
  assert.deepEqual(analysis.priorDistribution, { leading: 2, improving: 0, weakening: 0, lagging: 1 })
  assert.equal(analysis.rows.length, 3)
  assert.ok(analysis.rows.every((row) => row.pointCount === 17), 'future points must be excluded at the playback head')
  assert.equal(analysis.rows.find((row) => row.name === '行业甲')?.currentStreak, 17)
  assert.deepEqual(analysis.confirmedLeaders.sort(), ['行业乙', '行业甲'])
  assert.equal(analysis.improvingCandidates.length, 0)
  assert.ok(analysis.synchronousPairs.some((pair) => pair.leftName === '行业甲' && pair.rightName === '行业乙'))
  assert.ok(analysis.differentiatedPairs.some((pair) => pair.leftName === '行业甲' && pair.rightName === '行业丙'))
  assert.ok(analysis.rows.every((row) => row.leaderRatio >= 0 && row.leaderRatio <= 1))
}

verifyPresetIsolation()
verifyHistoricalAnalysis()

console.log(JSON.stringify({
  ok: true,
  checks: [
    'A-share and Hong Kong industry presets remain isolated by market',
    'preset sizes, benchmark modes, history windows, and comparison keys',
    'historical analysis is clipped to the playback head date',
    'quadrant persistence, historical leader frequency, and pair relationships',
  ],
}, null, 2))
