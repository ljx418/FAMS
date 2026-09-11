import assert from 'node:assert/strict'
import { buildRelativeRotationSeries, type RotationInputPoint } from '../src/services/relative-rotation/relativeRotationService.js'
import {
  buildEqualWeightResearchBenchmark,
  calculateIceDxyFromUsdReferenceRates,
  normalizeRotationResearchTarget,
  relativeRotationUniverseService,
} from '../src/services/relative-rotation/relativeRotationUniverseService.js'
import {
  normalizeCsindexOfficialPerformanceRows,
  resolveChinaIndexIdentity,
} from '../src/utils/stockUtils.js'

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

function weeklyFixture(multiplier: number): RotationInputPoint[] {
  const start = new Date('2025-01-06T00:00:00.000Z')
  return Array.from({ length: 60 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + (index * 7))
    return {
      date: isoDate(date),
      close: 100 * multiplier * (1 + (index * 0.004) + Math.sin(index / 5) * 0.01),
    }
  })
}

function main() {
  assert.deepEqual(normalizeRotationResearchTarget('CN', {
    code: '600276.SH', name: '恒瑞医药', kind: 'equity',
  }), {
    targetKey: 'CN:equity:600276',
    market: 'CN', symbol: '600276', name: '恒瑞医药', kind: 'equity', assetType: 'stock',
  })
  assert.deepEqual(normalizeRotationResearchTarget('CN', {
    code: '399989', name: '中证医疗指数', kind: 'index',
  }), {
    targetKey: 'CN:index:399989.SZ',
    market: 'CN', symbol: '399989.SZ', name: '中证医疗指数', kind: 'index', assetType: 'index',
  })
  const aiSupplyChain = [
    ['930708', '930708.CSI', '上游资源', 1],
    ['H30199', 'H30199.CSI', '能源供给', 2],
    ['H30184', 'H30184.CSI', '核心器件', 3],
    ['930851', '930851.CSI', '算力与数据', 4],
    ['930601', '930601.CSI', '软件应用', 5],
    ['930713', '930713.CSI', 'AI综合主题', 6],
  ] as const
  for (const [input, symbol, stage, order] of aiSupplyChain) {
    const target = normalizeRotationResearchTarget('CN', { code: input, kind: 'index' })
    const identity = resolveChinaIndexIdentity(input)
    assert.equal(target.symbol, symbol)
    assert.equal(target.targetKey, `CN:index:${symbol}`)
    assert.equal(target.taxonomy?.stage, stage)
    assert.equal(target.taxonomy?.order, order)
    assert.equal(target.assetType, 'index')
    assert.equal(target.taxonomy?.representation, 'price_index')
    assert.equal(identity?.csindexCode, input)
  }
  assert.equal(
    normalizeRotationResearchTarget('CN', { code: '930713.SH', kind: 'index' }).targetKey,
    'CN:index:930713.CSI',
  )
  assert.equal(
    normalizeRotationResearchTarget('CN', { code: 'H30184.CSI', kind: 'index' }).targetKey,
    'CN:index:H30184.CSI',
  )
  const officialIdentity = resolveChinaIndexIdentity('930708.CSI')
  assert.ok(officialIdentity)
  const parsedOfficialRows = normalizeCsindexOfficialPerformanceRows([
    { tradeDate: '20260908', indexCode: '930708', indexNameCnAll: '中证有色金属指数', close: 3002.75, tradingVol: 10 },
    { tradeDate: '20260909', indexCode: '930708', indexNameCnAll: '中证有色金属指数', open: 3007.23, high: 3055.58, low: 2998.92, close: 3050.14, tradingVol: 12 },
    { tradeDate: '20260909', indexCode: '930713', close: 5900.45 },
  ], officialIdentity)
  assert.equal(parsedOfficialRows.length, 2)
  assert.deepEqual(parsedOfficialRows[0], {
    date: '2026-09-08', name: '中证有色金属指数', open: 3002.75, high: 3002.75, low: 3002.75,
    close: 3002.75, volume: 10, source: 'csindex_official_price_index', adjustType: 'none',
  })
  assert.equal(parsedOfficialRows[1].close, 3050.14)
  assert.equal(normalizeRotationResearchTarget('HK', {
    code: '175', name: '吉利汽车', kind: 'equity',
  }).symbol, '00175.HK')
  assert.throws(
    () => normalizeRotationResearchTarget('HK', { code: 'HSI', name: '恒生指数', kind: 'index' }),
    /仅支持 A 股价格指数/,
  )
  assert.deepEqual(normalizeRotationResearchTarget('US', {
    code: 'DX-Y.NYB', name: '美元指数 DXY', kind: 'index',
  }), {
    targetKey: 'US:index:DX-Y.NYB',
    market: 'US', symbol: 'DX-Y.NYB', name: '美元指数 DXY', kind: 'index', assetType: 'index',
  })

  const macroTargets = ['SPY', 'TLT', 'IEF', 'GLD'].map((code) => normalizeRotationResearchTarget('US', {
    code, kind: 'equity', name: code,
  }))
  macroTargets.push(normalizeRotationResearchTarget('US', { code: 'DX-Y.NYB', kind: 'index' }))
  assert.deepEqual(
    relativeRotationUniverseService.normalizeResearchBenchmark(macroTargets, {
      mode: 'equal_weight_targets',
      targetKeys: macroTargets.map((target) => target.targetKey),
    }),
    { mode: 'equal_weight_targets', targetKeys: macroTargets.map((target) => target.targetKey) },
  )
  assert.throws(
    () => relativeRotationUniverseService.normalizeResearchBenchmark(macroTargets, {
      mode: 'equal_weight_targets', targetKeys: [macroTargets[0].targetKey],
    }),
    /至少需要两个/,
  )

  const composite = buildEqualWeightResearchBenchmark([
    {
      targetKey: 'US:equity:LEFT', symbol: 'LEFT', name: 'LEFT', history: [
        { date: '2026-01-02', open: 100, high: 100, low: 100, close: 100, volume: 0, source: 'fixture', adjustType: 'none' },
        { date: '2026-01-05', open: 110, high: 110, low: 110, close: 110, volume: 0, source: 'fixture', adjustType: 'none' },
      ],
    },
    {
      targetKey: 'US:equity:RIGHT', symbol: 'RIGHT', name: 'RIGHT', history: [
        { date: '2026-01-02', open: 100, high: 100, low: 100, close: 100, volume: 0, source: 'fixture', adjustType: 'none' },
        { date: '2026-01-05', open: 90, high: 90, low: 90, close: 90, volume: 0, source: 'fixture', adjustType: 'none' },
      ],
    },
  ])
  assert.equal(composite.history.length, 2)
  assert.equal(composite.history[0].close, 100)
  assert.equal(composite.history[1].close, 100)
  assert.equal(composite.components[0].weight, 0.5)

  const replicatedDxy = calculateIceDxyFromUsdReferenceRates({
    // ECB reference rates quoted as foreign-currency units per USD on
    // 2026-09-07; official ICE weights should yield a DXY-scale level.
    EUR: 0.86044, JPY: 154.75, GBP: 0.73906, CAD: 1.382, SEK: 9.6042, CHF: 0.80924,
  })
  assert.ok(replicatedDxy && replicatedDxy > 98 && replicatedDxy < 100)

  const series = buildRelativeRotationSeries(weeklyFixture(1.08), weeklyFixture(1), 'weekly')
  assert.equal(series.alignedObservations, 60)
  assert.equal(series.points.length, 19)
  assert.ok(series.points.every((point) => Number.isFinite(point.relativeTrend) && Number.isFinite(point.relativeMomentum)))
  assert.equal(series.points[0].deltaX, null)
  assert.notEqual(series.points[1].deltaX, null)

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'CN equity and price-index research identities',
      'domestic AI supply-chain CSI aliases, official source identities, and taxonomy ordering',
      'official CSI price-index response validation and close-only normalization',
      'HK equity code normalization',
      'non-CN research index rejection',
      'US DXY price-index identity and locked equal-weight benchmark validation',
      'daily rebalanced equal-weight price-return composite',
      'auditable ICE DXY formula replication from USD reference FX rates',
      'weekly RRG warm-up and coordinate generation',
    ],
  }, null, 2))
}

main()
