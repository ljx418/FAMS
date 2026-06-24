import assert from 'node:assert/strict'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'

type FixtureBar = {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  source: string
}

function dateAt(index: number) {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
}

function buildAFlushFixture(options: {
  lowLiquidity?: boolean
  limitUpEntry?: boolean
  takeProfitAfterEntry?: boolean
  trailingStopAfterEntry?: boolean
  closeEntryDifferent?: boolean
  highVolatilityRegime?: boolean
} = {}): FixtureBar[] {
  const rows: FixtureBar[] = []
  for (let index = 0; index < 90; index += 1) {
    const isRecent = index >= 60
    let close = isRecent ? 80 + ((index % 4) - 1.5) * 0.45 : 128 - index * 0.75
    if (index >= 86) close = 81 + (index - 86) * 0.75
    if (options.limitUpEntry && index === 86) close = Number((rows[index - 1].close * 1.1).toFixed(3))
    const high = options.highVolatilityRegime && index >= 65 && index <= 85
      ? close * 1.13
      : (options.takeProfitAfterEntry || options.trailingStopAfterEntry) && index === 87
      ? Number((rows[86].close * 1.12).toFixed(3))
      : close * (index < 50 ? 1.08 : 1.02)
    const low = options.highVolatilityRegime && index >= 65 && index <= 85
      ? close * 0.86
      : options.trailingStopAfterEntry && index === 87
      ? Number((rows[86].close * 0.99).toFixed(3))
      : close * 0.98
    const open = options.closeEntryDifferent && index === 86 ? Number((close * 0.98).toFixed(3)) : close
    const volume = index >= 80 ? 2400 : 1000
    const amount = options.lowLiquidity ? 10_000 : close * volume * 100
    rows.push({
      date: dateAt(index),
      open,
      close,
      high: options.limitUpEntry && index === 86 ? close : high,
      low,
      volume,
      amount,
      source: 'fixture',
    })
  }
  return rows
}

function getAFlushTournament(
  history: FixtureBar[],
  name = '可信回测样例',
  query = '多策略胜率；验证天数=1；持有天数=3',
  assetOverrides: Record<string, unknown> = {}
) {
  const tournament = stockScreenerService.evaluateStrategyTournament(
    [{ asset: { symbol: '600010', name, type: 'stock', ...assetOverrides } as any, history }],
    stockScreenerService.parseOptions(query)
  )
  const expectedHoldingDays = stockScreenerService.parseOptions(query).holdingDays
  const backtest = tournament.ranked.find((item) =>
    item.strategyId === 'a_flush_sideways_volume' &&
    item.executionPolicy.entryMode === 't1_open' &&
    item.executionPolicy.holdingDays === expectedHoldingDays &&
    item.executionPolicy.exitMode === 'fixed_hold' &&
    item.executionPolicy.positionSizingMode === 'equal_notional'
  )
  assert.ok(backtest, 'tournament should include A flush strategy')
  return { tournament, backtest }
}

function main() {
  const executable = getAFlushTournament(buildAFlushFixture())
  const sample = executable.backtest.samples[0]
  assert.ok(sample, 'fixture should produce an executable sample')
  assert.equal(sample.signalDate, '2026-03-27', 'signal should be generated on T day')
  assert.equal(sample.entryDate, '2026-03-28', 'entry should happen at T+1 open')
  assert.ok(sample.entryReason?.includes('开盘'), 'sample should record T+1 open entry reason')
  assert.equal(sample.exitDate, '2026-03-31', 'exit should happen after holding N trading days')
  assert.ok(sample.grossReturnPercent > sample.returnPercent, 'net return should be lower than gross return after costs')
  assert.ok((sample.costPercent || 0) > 0, 'sample should expose cost impact')
  assert.ok(executable.tournament.assumptions.costModel.commissionRate > 0, 'assumptions should expose commission rate')
  assert.equal(executable.tournament.assumptions.marketConstraints.limitUpCannotBuy, true)
  assert.equal(executable.tournament.executionMatrix.schemaVersion, 'fams.screener.execution_matrix.v1')
  assert.equal(executable.tournament.executionMatrix.executionPolicies.length, 42)
  assert.equal(executable.tournament.executionMatrix.totalCandidates, 126)
  assert.ok(
    executable.tournament.executionMatrix.executionPolicies.some((item) => item.exitMode === 'stop_take_profit' && item.stopLossPercent === 5 && item.takeProfitPercent === 10),
    'execution matrix should include stop-loss/take-profit exit policy'
  )
  assert.ok(
    executable.tournament.executionMatrix.executionPolicies.some((item) => item.entryMode === 't1_close'),
    'execution matrix should include T+1 close entry policy'
  )
  assert.ok(
    executable.tournament.executionMatrix.executionPolicies.some((item) => item.exitMode === 'trailing_stop' && item.trailingStopPercent === 8),
    'execution matrix should include trailing stop exit policy'
  )
  assert.ok(
    executable.tournament.executionMatrix.executionPolicies.some((item) => item.positionSizingMode === 'volatility_scaled'),
    'execution matrix should include volatility-scaled sizing policy'
  )
  assert.ok(
    executable.tournament.executionMatrix.executionPolicies.some((item) => item.regimeFilterMode === 'avoid_high_volatility_chop'),
    'execution matrix should include high-volatility-chop regime filter policy'
  )
  assert.equal(executable.backtest.candidateId, 'a_flush_sideways_volume__entry_t1_open__exit_h3__size_equal_notional')
  assert.equal(executable.backtest.executionPolicy.entryMode, 't1_open')
  assert.equal(executable.backtest.executionPolicy.holdingDays, 3)
  assert.equal(executable.backtest.executionPolicy.exitMode, 'fixed_hold')
  assert.equal(executable.backtest.executionPolicy.positionSizingMode, 'equal_notional')
  assert.equal(executable.backtest.versionBundle.schemaVersion, 'fams.screener.tournament_candidate.v1')
  assert.equal(executable.backtest.versionBundle.signalStrategy.id, 'a_flush_sideways_volume')
  assert.equal(executable.backtest.versionBundle.entryPolicy.version, 'entry.t1_open.v1')
  assert.equal(executable.backtest.versionBundle.exitPolicy.version, 'exit.hold_n.close.v1')
  assert.equal(executable.backtest.versionBundle.costModel.version, 'cost.cn_equity.v1')
  assert.equal(executable.backtest.versionBundle.regimeFilterPolicy?.version, 'regime_filter.none.v1')
  assert.match(executable.backtest.auditHash, /^[a-f0-9]{64}$/)
  assert.equal(executable.backtest.outOfSampleValidation.schemaVersion, 'fams.screener.oos_validation.v1')
  assert.equal(executable.backtest.outOfSampleValidation.status, 'insufficient')
  assert.equal(executable.backtest.outOfSampleValidation.outOfSample.sampleSize, 0)
  assert.equal(executable.backtest.walkForwardValidation.schemaVersion, 'fams.screener.walk_forward.v1')
  assert.equal(executable.backtest.walkForwardValidation.status, 'insufficient')
  assert.equal(executable.backtest.walkForwardValidation.totalWindows, 3)
  assert.equal(executable.backtest.parameterSensitivity.schemaVersion, 'fams.screener.parameter_sensitivity.v1')
  assert.equal(executable.backtest.parameterSensitivity.status, 'insufficient')
  assert.equal(executable.backtest.parameterSensitivity.totalVariants, 9)
  assert.equal(executable.backtest.groupStabilityValidation.schemaVersion, 'fams.screener.group_stability.v1')
  assert.equal(executable.backtest.groupStabilityValidation.status, 'insufficient')
  assert.equal(executable.backtest.groupStabilityValidation.dimensions.length, 4)
  assert.ok(sample.marketSegment, 'sample should expose market segment for grouped stability')
  assert.ok(sample.industryGroup, 'sample should expose industry group for grouped stability')
  assert.ok(sample.marketCapGroup, 'sample should expose market-cap/liquidity proxy for grouped stability')
  assert.ok(sample.marketRegime, 'sample should expose market regime for grouped stability')
  assert.equal(sample.groupMetadata?.schemaVersion, 'fams.screener.group_metadata.v1')
  assert.ok(sample.groupMetadata?.industryGroup.provider, 'group metadata should expose industry provider')
  assert.ok((sample.groupMetadata?.industryGroup.confidence || 0) > 0, 'group metadata should expose confidence')
  assert.equal(executable.backtest.credibility.rating, 'insufficient', 'single-sample backtest must not be medium/high confidence')

  const officialMetadata = getAFlushTournament(buildAFlushFixture(), '可信回测样例', '多策略胜率；验证天数=1；持有天数=3', {
    officialIndustryGroup: '乘用车',
    officialIndustryCode: 'BK1262',
    totalMarketCap: 120_000_000_000,
    metadataAsOf: '2026-03-27T15:00:00.000Z',
    metadataWarnings: [],
  })
  const officialSample = officialMetadata.backtest.samples[0]
  assert.equal(officialSample.groupMetadata?.industryGroup.provider, 'eastmoney_fundamental_cache')
  assert.equal(officialSample.groupMetadata?.industryGroup.value, '乘用车(BK1262)')
  assert.equal(officialSample.groupMetadata?.marketCapGroup.provider, 'eastmoney_fundamental_cache')
  assert.equal(officialSample.groupMetadata?.marketCapGroup.value, '大盘')
  assert.ok(officialSample.groupMetadata?.marketCapGroup.sourceRefs?.some((ref) => ref.includes('em_total_market_cap')))

  const closeEntry = getAFlushTournament(buildAFlushFixture({ closeEntryDifferent: true }))
  const closeEntryBacktest = closeEntry.tournament.ranked.find((item) => item.candidateId === 'a_flush_sideways_volume__entry_t1_close__exit_h3__size_equal_notional')
  assert.ok(closeEntryBacktest?.samples[0], 'tournament should include T+1 close entry candidate')
  assert.equal(closeEntryBacktest.versionBundle.entryPolicy.version, 'entry.t1_close.v1')
  assert.ok(closeEntryBacktest.samples[0].entryReason?.includes('收盘'), 'T+1 close candidate should record close entry reason')
  assert.notEqual(closeEntryBacktest.samples[0].entryPrice, closeEntry.backtest.samples[0].entryPrice, 'open and close entry policies should use different entry prices when bars differ')

  const guardedBacktest = executable.tournament.ranked.find((item) => item.candidateId === 'a_flush_sideways_volume__entry_t1_open__exit_h3_sl5_tp10__size_equal_notional')
  assert.ok(guardedBacktest, 'tournament should include guarded stop-loss/take-profit candidate')
  assert.equal(guardedBacktest.executionPolicy.exitMode, 'stop_take_profit')
  assert.equal(guardedBacktest.versionBundle.exitPolicy.version, 'exit.stop_take_profit.v1')

  const takeProfit = getAFlushTournament(buildAFlushFixture({ takeProfitAfterEntry: true }))
  const takeProfitGuarded = takeProfit.tournament.ranked.find((item) => item.candidateId === 'a_flush_sideways_volume__entry_t1_open__exit_h3_sl5_tp10__size_equal_notional')
  assert.ok(takeProfitGuarded?.samples[0], 'guarded candidate should produce a take-profit sample')
  assert.equal(takeProfitGuarded.samples[0].exitDate, '2026-03-29', 'take-profit exit should happen before fixed holding exit')
  assert.ok(takeProfitGuarded.samples[0].exitReason?.includes('止盈'), 'sample should record take-profit exit reason')

  const trailingStop = getAFlushTournament(buildAFlushFixture({ trailingStopAfterEntry: true }))
  const trailingBacktest = trailingStop.tournament.ranked.find((item) => item.candidateId === 'a_flush_sideways_volume__entry_t1_open__exit_h3_trail8__size_equal_notional')
  assert.ok(trailingBacktest?.samples[0], 'trailing stop candidate should produce a sample')
  assert.equal(trailingBacktest.versionBundle.exitPolicy.version, 'exit.trailing_stop.v1')
  assert.equal(trailingBacktest.versionBundle.exitPolicy.trailingStopPercent, 8)
  assert.equal(trailingBacktest.samples[0].exitDate, '2026-03-29', 'trailing stop should exit before fixed holding exit')
  assert.ok(trailingBacktest.samples[0].exitReason?.includes('移动止盈'), 'sample should record trailing stop exit reason')

  const volatilityScaledBacktest = executable.tournament.ranked.find((item) => item.candidateId === 'a_flush_sideways_volume__entry_t1_open__exit_h3__size_volatility_scaled')
  assert.ok(volatilityScaledBacktest?.samples[0], 'tournament should include volatility-scaled sizing candidate')
  assert.equal(volatilityScaledBacktest.versionBundle.positionSizingPolicy.version, 'sizing.volatility_scaled_notional.v1')
  assert.ok((volatilityScaledBacktest.samples[0].notional || 0) <= 10000, 'volatility-scaled notional should not exceed base notional')
  assert.ok(volatilityScaledBacktest.samples[0].positionSizingReason?.includes('波动率'), 'sample should record volatility sizing reason')

  const regimeFiltered = getAFlushTournament(buildAFlushFixture({ highVolatilityRegime: true }))
  const highVolatilityFilteredBacktest = regimeFiltered.tournament.ranked.find((item) =>
    item.candidateId === 'a_flush_sideways_volume__entry_t1_open__exit_h3__size_equal_notional__regime_avoid_high_volatility_chop'
  )
  assert.ok(highVolatilityFilteredBacktest, 'tournament should include high-volatility-chop regime filter candidate')
  assert.equal(highVolatilityFilteredBacktest?.tradeCount, 0, 'high-volatility-chop filter should block the executable sample')
  assert.ok(
    highVolatilityFilteredBacktest?.blockedSamples.some((item) => item.blockedReason?.includes('高波动震荡不交易')),
    'high-volatility-chop filter should record blocked regime reason'
  )
  assert.equal(highVolatilityFilteredBacktest?.versionBundle.regimeFilterPolicy?.version, 'regime_filter.local_price_window.avoid_high_volatility_chop.v1')

  const lowLiquidity = getAFlushTournament(buildAFlushFixture({ lowLiquidity: true }))
  assert.equal(lowLiquidity.backtest.tradeCount, 0, 'low liquidity sample should not become executable trade')
  assert.ok(
    lowLiquidity.backtest.blockedSamples.some((item) => item.blockedReason?.includes('成交额不足')),
    'low liquidity sample should record market constraint warning'
  )

  const stBlocked = getAFlushTournament(buildAFlushFixture(), '*ST可信回测')
  assert.equal(stBlocked.backtest.tradeCount, 0, 'ST sample should not become executable trade')
  assert.ok(
    stBlocked.backtest.blockedSamples.some((item) => item.blockedReason?.includes('ST')),
    'ST sample should record exclusion reason'
  )

  const limitUpBlocked = getAFlushTournament(buildAFlushFixture({ limitUpEntry: true }))
  assert.equal(limitUpBlocked.backtest.tradeCount, 0, 'limit-up T+1 entry should not become executable trade')
  assert.ok(
    limitUpBlocked.backtest.blockedSamples.some((item) => item.blockedReason?.includes('涨停')),
    'limit-up entry should record buy block reason'
  )

  const widerSample = getAFlushTournament(buildAFlushFixture(), '可信回测样例', '多策略胜率；验证天数=5；持有天数=3')
  assert.ok(typeof widerSample.backtest.maxDrawdownPercent === 'number', 'backtest should expose max drawdown')
  assert.ok(typeof widerSample.backtest.tailLossP95Percent === 'number', 'backtest should expose tail loss P95')
  assert.ok(typeof widerSample.backtest.profitFactor === 'number' || widerSample.backtest.profitFactor === null, 'backtest should expose profit factor')
  assert.ok(widerSample.backtest.equityCurve.length >= 1, 'backtest should expose equity curve points')
  assert.ok(typeof widerSample.backtest.equityCurve[0].drawdownPercent === 'number', 'equity curve should expose drawdown')
  assert.equal(widerSample.backtest.sampleSize, widerSample.backtest.tradeCount + widerSample.backtest.blockedSamples.length)
  assert.equal(widerSample.backtest.outOfSampleValidation.method, 'chronological_70_30_split')
  assert.ok(widerSample.backtest.outOfSampleValidation.train.sampleSize >= 1, 'train split should contain samples')
  assert.ok(widerSample.backtest.outOfSampleValidation.outOfSample.sampleSize >= 1, 'out-of-sample split should contain samples')
  assert.equal(widerSample.backtest.walkForwardValidation.method, 'chronological_3_window_split')
  assert.equal(widerSample.backtest.walkForwardValidation.windows.length, 3)
  assert.equal(widerSample.backtest.parameterSensitivity.method, 'local_threshold_grid_v2')
  assert.equal(widerSample.backtest.parameterSensitivity.variants.length, 9)
  assert.equal(widerSample.backtest.parameterSensitivity.variants[0].variantId, 'base')
  assert.equal(widerSample.backtest.groupStabilityValidation.method, 'post_trade_grouped_outcome_audit')
  assert.ok(
    widerSample.backtest.groupStabilityValidation.dimensions.some((item) => item.dimension === 'market_regime' && item.groups.length >= 1),
    'group stability should include market regime buckets'
  )
  assert.ok(
    widerSample.backtest.groupStabilityValidation.dimensions.every((item) => Array.isArray(item.providerSummary) && typeof item.averageConfidence === 'number'),
    'group stability dimensions should expose provider summary and confidence'
  )
  assert.ok(
    widerSample.backtest.groupStabilityValidation.dimensions.some((item) => item.groups.some((group) => group.provider && typeof group.confidence === 'number')),
    'group stability buckets should expose provider and confidence'
  )
  assert.ok(
    widerSample.backtest.parameterSensitivity.variants.some((item) => item.variantId.includes('__')),
    'parameter sensitivity should include combined two-parameter variants'
  )

  console.log(JSON.stringify({
    ok: true,
    executable: {
      signalDate: sample.signalDate,
      entryDate: sample.entryDate,
      exitDate: sample.exitDate,
      grossReturnPercent: sample.grossReturnPercent,
      returnPercent: sample.returnPercent,
      costPercent: sample.costPercent,
      credibility: executable.backtest.credibility.rating,
      candidateId: executable.backtest.candidateId,
      executionMatrix: executable.tournament.executionMatrix,
      auditHash: executable.backtest.auditHash,
      versionBundle: executable.backtest.versionBundle,
      outOfSampleValidation: executable.backtest.outOfSampleValidation,
      walkForwardValidation: executable.backtest.walkForwardValidation,
      parameterSensitivity: executable.backtest.parameterSensitivity,
      groupStabilityValidation: executable.backtest.groupStabilityValidation,
    },
    constraints: {
      lowLiquidity: lowLiquidity.backtest.blockedSamples[0]?.blockedReason,
      st: stBlocked.backtest.blockedSamples[0]?.blockedReason,
      limitUp: limitUpBlocked.backtest.blockedSamples[0]?.blockedReason,
    },
    metrics: {
      sampleSize: widerSample.backtest.sampleSize,
      tradeCount: widerSample.backtest.tradeCount,
      maxDrawdownPercent: widerSample.backtest.maxDrawdownPercent,
      tailLossP95Percent: widerSample.backtest.tailLossP95Percent,
      profitFactor: widerSample.backtest.profitFactor,
      equityCurve: widerSample.backtest.equityCurve,
      outOfSampleValidation: widerSample.backtest.outOfSampleValidation,
      walkForwardValidation: widerSample.backtest.walkForwardValidation,
      parameterSensitivity: widerSample.backtest.parameterSensitivity,
      groupStabilityValidation: widerSample.backtest.groupStabilityValidation,
    },
  }, null, 2))
}

main()
