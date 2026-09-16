import {
  alipayPortfolioComparisonService,
  type AlipayPortfolioComparisonStudy,
  type ComparisonMetrics,
  type ComparisonStrategy,
} from './alipayPortfolioComparisonService.js'

type ScenarioMode = {
  metrics: ComparisonMetrics
  curve: ComparisonStrategy['curve']
  trades: ComparisonStrategy['trades']
}

export type AlipayThresholdScenario = {
  thresholdPercentagePoints: number
  label: string
  freeConversion: ScenarioMode
  costInclusive: ScenarioMode
  rebalanceEventCount: { freeConversion: number; costInclusive: number }
}

type ModeRecommendation = {
  selectedThresholdPercentagePoints: number
  headline: string
  summary: string
  evidence: string[]
  confidence: 'low'
}

export type AlipayThresholdSensitivityReport = {
  schemaVersion: 'portfolio.alipay_ytd_threshold_sensitivity.v1'
  generatedAt: string
  status: 'passed'
  title: string
  dataBasis: {
    currentYear: number
    requestedPeriod: { startDate: string; endDate: string }
    effectivePeriod: { startDate: string; endDate: string; tradingDays: number }
    sourceHash: string
    sourceProfile: AlipayPortfolioComparisonStudy['dataAudit']['sourceProfile']
    initialCapital: number
    positionCount: number
    proxyCoveragePercent: 0
    freshnessLagCalendarDays: number
    targetSeries: Array<{
      symbol: string
      name: string
      bucket: string
      targetWeightPercent: number
      bars: number
      firstDate: string
      lastDate: string
      sources: string[]
    }>
    determinism: {
      verified: boolean
      runCount: number
      matchingSourceHash: boolean
      matchingResults: boolean
    }
  }
  assumptions: {
    targetBucketWeights: { cash: 10; gold: 15; bond: 50; equity: 25 }
    thresholdsPercentagePoints: number[]
    driftComparison: 'strictly_greater_than'
    executionTiming: 'decision_at_close_execute_next_common_nav_day'
    rebalanceScope: 'restore_full_target_bucket_weights'
    cashAnnualRatePercent: 1
    freeConversion: { feeRatePercent: 0; slippageRatePercent: 0 }
    costInclusive: { feeRatePercent: 0.03; slippageRatePercent: 0.05; minimumFeeCny: 0 }
    screenshotStatus: 'latest_persisted_snapshot_only'
  }
  scenarios: AlipayThresholdScenario[]
  recommendation: {
    costInclusive: ModeRecommendation
    freeConversion: ModeRecommendation
  }
  limitations: string[]
  allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE']
  prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
  notTradingAdvice: true
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function uniqueRebalanceEvents(trades: ComparisonStrategy['trades']) {
  return new Set(trades.filter((trade) => trade.reason === 'drift_rebalance').map((trade) => trade.decisionDate)).size
}

function recommendationFor(scenarios: AlipayThresholdScenario[], mode: 'freeConversion' | 'costInclusive'): ModeRecommendation {
  const baseline = scenarios.find((scenario) => scenario.thresholdPercentagePoints === 3)
  if (!baseline) throw new Error('threshold_3_baseline_missing')
  const totalReturns = scenarios.map((scenario) => scenario[mode].metrics.totalReturnPercent)
  const drawdowns = scenarios.map((scenario) => scenario[mode].metrics.maxDrawdownPercent)
  const returnSpan = Math.max(...totalReturns) - Math.min(...totalReturns)
  const drawdownSpan = Math.max(...drawdowns) - Math.min(...drawdowns)
  const baselineMetrics = baseline[mode].metrics
  const alternatives = scenarios
    .filter((scenario) => scenario.thresholdPercentagePoints !== 3)
    .filter((scenario) => {
      const metrics = scenario[mode].metrics
      const returnDifference = metrics.totalReturnPercent - baselineMetrics.totalReturnPercent
      const drawdownDifference = metrics.maxDrawdownPercent - baselineMetrics.maxDrawdownPercent
      return (returnDifference >= 0.1 && drawdownDifference >= -0.1)
        || (drawdownDifference >= 0.25 && returnDifference >= -0.1)
    })
    .sort((left, right) => {
      const returnDifference = right[mode].metrics.totalReturnPercent - left[mode].metrics.totalReturnPercent
      if (Math.abs(returnDifference) > 0.0001) return returnDifference
      const drawdownDifference = right[mode].metrics.maxDrawdownPercent - left[mode].metrics.maxDrawdownPercent
      if (Math.abs(drawdownDifference) > 0.0001) return drawdownDifference
      return left[mode].metrics.totalCostCny - right[mode].metrics.totalCostCny
    })

  if (returnSpan < 0.1 && drawdownSpan < 0.1) {
    return {
      selectedThresholdPercentagePoints: 3,
      headline: '本年度样本没有证据支持降低3%阈值',
      summary: '三个阈值的收益与回撤差异都小于0.10个百分点。降低阈值没有形成可辨认的风险收益改善，继续保留3%可避免无效监控和潜在额外换手。',
      evidence: [
        `区间收益最大差异 ${round(returnSpan, 4).toFixed(4)} 个百分点`,
        `最大回撤最大差异 ${round(drawdownSpan, 4).toFixed(4)} 个百分点`,
        `3%阈值发生 ${baseline.rebalanceEventCount[mode]} 次再平衡`,
      ],
      confidence: 'low',
    }
  }

  const selected = alternatives[0] || baseline
  const selectedMetrics = selected[mode].metrics
  const isBaseline = selected.thresholdPercentagePoints === 3
  return {
    selectedThresholdPercentagePoints: selected.thresholdPercentagePoints,
    headline: isBaseline ? '保留3%阈值的风险收益权衡更稳妥' : `本年度样本倾向${selected.thresholdPercentagePoints}%阈值`,
    summary: isBaseline
      ? '更低阈值未同时达到“收益改善至少0.10个百分点且回撤不显著变差”，或“回撤改善至少0.25个百分点且收益损失不超过0.10个百分点”的预设门槛。'
      : '该阈值通过预设的收益/回撤改进门槛；仍需结合更长滚动窗口复核，不能仅凭未完整年度样本直接修改长期规则。',
    evidence: [
      `相对3%区间收益 ${round(selectedMetrics.totalReturnPercent - baselineMetrics.totalReturnPercent, 4).toFixed(4)} 个百分点`,
      `相对3%最大回撤 ${round(selectedMetrics.maxDrawdownPercent - baselineMetrics.maxDrawdownPercent, 4).toFixed(4)} 个百分点`,
      `再平衡 ${selected.rebalanceEventCount[mode]} 次，总成本 ${selectedMetrics.totalCostCny.toFixed(2)} 元`,
    ],
    confidence: 'low',
  }
}

function scenarioSignature(scenarios: AlipayThresholdScenario[]) {
  return JSON.stringify(scenarios.map((scenario) => ({
    threshold: scenario.thresholdPercentagePoints,
    free: scenario.freeConversion.metrics,
    cost: scenario.costInclusive.metrics,
    freeCurve: scenario.freeConversion.curve,
    costCurve: scenario.costInclusive.curve,
    freeTrades: scenario.freeConversion.trades,
    costTrades: scenario.costInclusive.trades,
  })))
}

export function buildAlipayYtdThresholdSensitivityReport(input: {
  study: AlipayPortfolioComparisonStudy
  comparisonStudy?: AlipayPortfolioComparisonStudy
  thresholds?: number[]
  now?: Date
}): AlipayThresholdSensitivityReport {
  const thresholds = input.thresholds || [3, 2.5, 2]
  const latestDate = input.study.sourceSnapshot.commonDates.at(-1)
  if (!latestDate) throw new Error('source_snapshot_dates_missing')
  const currentYear = Number(latestDate.slice(0, 4))
  const requestedStartDate = `${currentYear}-01-01`
  const requestedEndDate = `${currentYear}-12-31`
  const ytdDates = input.study.sourceSnapshot.commonDates.filter((date) => date >= requestedStartDate && date <= requestedEndDate)
  if (ytdDates.length < 20) throw new Error(`ytd_common_trading_days_insufficient:${ytdDates.length}/20`)
  const effectiveStartDate = ytdDates[0]
  const effectiveEndDate = ytdDates.at(-1)!
  const target = input.study.strategies.find((strategy) => strategy.group === 'target')
  if (!target) throw new Error('target_strategy_missing')
  const targetComponents = target.components.filter((component) => component.bucket !== 'cash')
  const seriesBySymbol = input.study.sourceSnapshot.series
  const targetSeries = targetComponents.map((component) => {
    const bars = (seriesBySymbol[component.symbol] || []).filter((bar) => bar.date >= effectiveStartDate && bar.date <= effectiveEndDate)
    if (bars.length !== ytdDates.length) throw new Error(`target_series_gap:${component.symbol}:${bars.length}/${ytdDates.length}`)
    if (bars.some((bar) => bar.proxy || bar.directSymbol !== component.symbol || bar.source.startsWith('proxy:'))) {
      throw new Error(`target_series_proxy_not_allowed:${component.symbol}`)
    }
    if (component.symbol === '002611' && bars.some((bar) => bar.close < 0.1 || bar.close > 10)) {
      throw new Error('gold_fund_nav_scale_invalid:002611')
    }
    return {
      symbol: component.symbol,
      name: component.name,
      bucket: component.bucket,
      targetWeightPercent: component.targetWeightPercent,
      bars: bars.length,
      firstDate: bars[0].date,
      lastDate: bars.at(-1)!.date,
      sources: Array.from(new Set(bars.map((bar) => bar.source))),
    }
  })

  const buildScenarios = (study: AlipayPortfolioComparisonStudy) => thresholds.map((threshold): AlipayThresholdScenario => {
    const window = alipayWindow(study, effectiveStartDate, effectiveEndDate, threshold)
    const strategy = window.restartAtWindowStart.strategies.find((item) => item.group === 'target')
    if (!strategy || !strategy.costStressMetrics || !strategy.costStressCurve || !strategy.costStressTrades) {
      throw new Error(`threshold_scenario_incomplete:${threshold}`)
    }
    return {
      thresholdPercentagePoints: threshold,
      label: `${threshold}%偏离阈值`,
      freeConversion: { metrics: strategy.metrics, curve: strategy.curve, trades: strategy.trades },
      costInclusive: { metrics: strategy.costStressMetrics, curve: strategy.costStressCurve, trades: strategy.costStressTrades },
      rebalanceEventCount: {
        freeConversion: uniqueRebalanceEvents(strategy.trades),
        costInclusive: uniqueRebalanceEvents(strategy.costStressTrades),
      },
    }
  })
  const scenarios = buildScenarios(input.study)
  const comparisonScenarios = input.comparisonStudy ? buildScenarios(input.comparisonStudy) : null
  const matchingSourceHash = input.comparisonStudy
    ? input.study.sourceSnapshot.sourceHash === input.comparisonStudy.sourceSnapshot.sourceHash
    : false
  const matchingResults = comparisonScenarios ? scenarioSignature(scenarios) === scenarioSignature(comparisonScenarios) : false
  if (input.comparisonStudy && (!matchingSourceHash || !matchingResults)) throw new Error('real_data_determinism_check_failed')

  const now = input.now || new Date()
  const freshnessLagCalendarDays = Math.max(0, Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(effectiveEndDate)) / 86_400_000))
  if (freshnessLagCalendarDays > 7) throw new Error(`source_snapshot_stale:${effectiveEndDate}:${freshnessLagCalendarDays}`)

  return {
    schemaVersion: 'portfolio.alipay_ytd_threshold_sensitivity.v1',
    generatedAt: now.toISOString(),
    status: 'passed',
    title: `${currentYear}年高防御组合再平衡阈值敏感性`,
    dataBasis: {
      currentYear,
      requestedPeriod: { startDate: requestedStartDate, endDate: requestedEndDate },
      effectivePeriod: { startDate: effectiveStartDate, endDate: effectiveEndDate, tradingDays: ytdDates.length },
      sourceHash: input.study.sourceSnapshot.sourceHash,
      sourceProfile: input.study.dataAudit.sourceProfile,
      initialCapital: input.study.snapshot.initialCapital,
      positionCount: input.study.snapshot.positionCount,
      proxyCoveragePercent: 0,
      freshnessLagCalendarDays,
      targetSeries,
      determinism: {
        verified: Boolean(input.comparisonStudy),
        runCount: input.comparisonStudy ? 2 : 1,
        matchingSourceHash,
        matchingResults,
      },
    },
    assumptions: {
      targetBucketWeights: { cash: 10, gold: 15, bond: 50, equity: 25 },
      thresholdsPercentagePoints: thresholds,
      driftComparison: 'strictly_greater_than',
      executionTiming: 'decision_at_close_execute_next_common_nav_day',
      rebalanceScope: 'restore_full_target_bucket_weights',
      cashAnnualRatePercent: 1,
      freeConversion: { feeRatePercent: 0, slippageRatePercent: 0 },
      costInclusive: { feeRatePercent: 0.03, slippageRatePercent: 0.05, minimumFeeCny: 0 },
      screenshotStatus: 'latest_persisted_snapshot_only',
    },
    scenarios,
    recommendation: {
      costInclusive: recommendationFor(scenarios, 'costInclusive'),
      freeConversion: recommendationFor(scenarios, 'freeConversion'),
    },
    limitations: [
      '今年尚未结束，区间年化只作为辅助指标，不代表可实现的全年收益。',
      '回测使用最新已持久化支付宝仓位快照；未确认的截图预览不会写入或替换正式仓位。',
      '基金历史累计净值来自项目本地免费数据缓存；本报告要求目标标的全程使用直接净值，代理覆盖率为0%。',
      '费用压力场景假设费率0.03%并叠加0.05%滑点；实际支付宝基金转换规则、持有期和费率可能不同。',
      '历史回测不能预测未来，阈值选择还应通过更长滚动窗口和样本外数据复核。',
    ],
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }
}

function alipayWindow(study: AlipayPortfolioComparisonStudy, startDate: string, endDate: string, threshold: number) {
  return alipayPortfolioComparisonService.runWindow(study, startDate, endDate, {
    targetDriftThresholdPercentagePoints: threshold,
  })
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

export function renderAlipayYtdThresholdSensitivityHtml(report: AlipayThresholdSensitivityReport) {
  const payload = safeJson(report)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.title}</title>
  <style>
    :root{color-scheme:light;--bg:#f3f6f8;--surface:#fff;--surface-2:#edf2f5;--ink:#10283f;--muted:#567086;--line:#cbd7df;--navy:#123f68;--navy-2:#1c5d8f;--amber:#b56b08;--amber-bg:#fff4dc;--teal:#087b72;--teal-bg:#e7f6f3;--red:#b33a3a;--shadow:0 10px 30px rgba(16,40,63,.08);--radius:12px;--space:8px}
    body[data-theme="dark"]{color-scheme:dark;--bg:#0c1722;--surface:#122334;--surface-2:#192d40;--ink:#edf5fa;--muted:#a8bdcc;--line:#355066;--navy:#88bce4;--navy-2:#b1d8f2;--amber:#f1b455;--amber-bg:#3b2a12;--teal:#63c9bd;--teal-bg:#103b38;--red:#ff9090;--shadow:none}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Microsoft YaHei","Noto Sans SC",sans-serif;font-size:16px;line-height:1.65}button{font:inherit}
    .shell{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:32px 0 56px}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:24px}.eyebrow{margin:0 0 8px;color:var(--teal);font-weight:700;letter-spacing:.08em;font-size:13px}.title{font-size:clamp(30px,4vw,52px);line-height:1.08;letter-spacing:-.04em;margin:0;max-width:820px;text-wrap:pretty}.subtitle{color:var(--muted);max-width:780px;margin:14px 0 0;text-wrap:pretty}.controls{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.control{min-height:44px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);padding:9px 14px;cursor:pointer;font-weight:700}.control:hover,.control:focus-visible{border-color:var(--navy-2);outline:3px solid color-mix(in srgb,var(--navy-2) 20%,transparent)}.control[aria-pressed="true"]{background:var(--navy);color:var(--surface);border-color:var(--navy)}
    .statusline{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:18px 0 0;color:var(--muted);font-size:14px}.status-dot{width:9px;height:9px;border-radius:50%;background:var(--teal);display:inline-block;margin-right:7px}.hash{font-family:Consolas,monospace;font-size:12px}
    .panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px;margin-top:16px}.recommendation{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(260px,.6fr);gap:24px;background:var(--navy);color:#fff;border-color:var(--navy)}.recommendation .tag{display:inline-flex;min-height:32px;align-items:center;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:3px 12px;font-weight:700;font-size:13px}.recommendation h2{font-size:clamp(23px,3vw,34px);line-height:1.25;margin:14px 0 10px;text-wrap:pretty}.recommendation p{margin:0;color:#dceaf4}.evidence{display:grid;gap:8px;align-content:center}.evidence div{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:11px 13px}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}.section-head h2{margin:0;font-size:22px}.section-head p{margin:0;color:var(--muted);font-size:14px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--surface-2)}.metric .label{font-size:13px;color:var(--muted)}.metric strong{display:block;font-size:27px;line-height:1.2;margin:6px 0;color:var(--navy)}.metric .detail{font-size:13px;color:var(--muted)}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{background:var(--surface-2);color:var(--muted);font-size:13px;position:sticky;top:0}td.number,th.number{text-align:right;font-variant-numeric:tabular-nums}.selected-row{background:var(--teal-bg)}.better{color:var(--teal);font-weight:700}.worse{color:var(--red);font-weight:700}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chart-card{border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0}.chart-card h3{font-size:16px;margin:0 0 4px}.chart-card p{font-size:13px;color:var(--muted);margin:0 0 10px}.canvas-wrap{height:320px;position:relative}canvas{width:100%;height:100%;display:block}.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--muted)}.swatch{width:20px;height:3px;display:inline-block;vertical-align:middle;margin-right:6px}.chart-readout{min-height:28px;color:var(--muted);font-size:13px;margin-top:6px}
    .method-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.method{border-top:3px solid var(--navy);padding-top:10px}.method strong{display:block;margin-bottom:5px}.method span{color:var(--muted);font-size:14px}.audit-list{display:grid;gap:8px}.audit-row{display:grid;grid-template-columns:84px 1fr 90px 130px;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}.audit-row span:last-child{text-align:right}.limitations{margin:0;padding-left:22px;color:var(--muted)}.footer{margin-top:20px;color:var(--muted);font-size:13px;text-align:center}
    body[data-density="compact"] .panel{padding:16px}body[data-density="compact"] th,body[data-density="compact"] td{padding:8px 10px}body[data-density="compact"] .canvas-wrap{height:250px}
    @media(max-width:850px){.shell{width:min(100% - 20px,720px);padding-top:20px}.topbar{display:block}.controls{justify-content:flex-start;margin-top:18px}.recommendation,.charts{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr}.method-grid{grid-template-columns:1fr 1fr}.audit-row{grid-template-columns:72px 1fr}.audit-row span:nth-child(3),.audit-row span:nth-child(4){text-align:left}.canvas-wrap{height:280px}.panel{padding:18px}}
    @media(max-width:480px){body{font-size:15px}.title{font-size:32px}.method-grid{grid-template-columns:1fr}.controls{display:grid;grid-template-columns:1fr 1fr}.control:last-child{grid-column:1/-1}.recommendation h2{font-size:24px}.section-head{display:block}.section-head p{margin-top:6px}.canvas-wrap{height:240px}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
  </style>
</head>
<body data-theme="light" data-density="comfortable">
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">FAMS · REAL DATA RESEARCH</p>
        <h1 class="title">${report.title}</h1>
        <p class="subtitle">同一份支付宝仓位快照、同一组目标资产，只改变组合资产桶的偏离触发阈值。默认展示已计入费率和滑点的压力口径。</p>
        <div class="statusline"><span><i class="status-dot"></i>数据验收通过</span><span id="periodText"></span><span class="hash" id="hashText"></span></div>
      </div>
      <div class="controls" aria-label="报告显示设置">
        <button class="control" id="costToggle" aria-pressed="true">含费压力</button>
        <button class="control" id="densityToggle" aria-pressed="false">紧凑视图</button>
        <button class="control" id="themeToggle" aria-pressed="false">深色模式</button>
      </div>
    </header>

    <section class="panel recommendation" aria-labelledby="recommendationTitle">
      <div><span class="tag">研究结论 · 低置信度</span><h2 id="recommendationTitle"></h2><p id="recommendationSummary"></p></div>
      <div class="evidence" id="recommendationEvidence"></div>
    </section>

    <section class="panel" aria-labelledby="metricsTitle">
      <div class="section-head"><div><h2 id="metricsTitle">阈值结果对比</h2><p>“今年收益”是首个共同净值日至最新数据日的区间收益；年化只作辅助。</p></div><p id="modeLabel"></p></div>
      <div class="metric-grid" id="metricGrid"></div>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>偏离阈值</th><th class="number">今年收益</th><th class="number">区间年化</th><th class="number">最大回撤</th><th class="number">月末最大回撤</th><th class="number">再平衡次数</th><th class="number">再平衡换手</th><th class="number">总成本</th></tr></thead><tbody id="comparisonRows"></tbody></table></div>
    </section>

    <section class="panel" aria-labelledby="curvesTitle">
      <div class="section-head"><div><h2 id="curvesTitle">收益率与回撤曲线</h2><p>三条曲线全部从100归一化；降低阈值只有在触发再平衡后才会产生分化。</p></div></div>
      <div class="charts">
        <article class="chart-card"><h3>累计收益率</h3><p>归一化净值，起点=100</p><div class="canvas-wrap"><canvas id="returnChart" aria-label="三个阈值的累计收益率曲线"></canvas></div><div class="chart-readout" id="returnReadout">移动指针查看同日数值</div><div class="legend" id="returnLegend"></div></article>
        <article class="chart-card"><h3>动态回撤</h3><p>相对此前净值高点的跌幅</p><div class="canvas-wrap"><canvas id="drawdownChart" aria-label="三个阈值的动态回撤曲线"></canvas></div><div class="chart-readout" id="drawdownReadout">移动指针查看同日数值</div><div class="legend" id="drawdownLegend"></div></article>
      </div>
    </section>

    <section class="panel" aria-labelledby="tradesTitle"><div class="section-head"><div><h2 id="tradesTitle">再平衡流水</h2><p>只列偏离触发的交易；首次建仓不计作再平衡次数。</p></div></div><div class="table-wrap"><table><thead><tr><th>阈值</th><th>决策日 → 执行日</th><th>方向</th><th>代码与名称</th><th class="number">成交额</th><th class="number">成本</th></tr></thead><tbody id="tradeRows"></tbody></table></div></section>

    <section class="panel" aria-labelledby="methodTitle"><div class="section-head"><div><h2 id="methodTitle">固定规则与数据边界</h2><p>所有阈值共享数据、资金、标的和执行时点。</p></div></div><div class="method-grid"><div class="method"><strong>目标配比</strong><span>现金10% / 黄金15% / 债券50% / 权益25%</span></div><div class="method"><strong>触发规则</strong><span>任一资产桶绝对偏离严格大于阈值</span></div><div class="method"><strong>执行规则</strong><span>收盘判定，下一共同净值日恢复完整目标</span></div><div class="method"><strong>压力成本</strong><span>费率0.03% + 滑点0.05%，无最低费用</span></div></div><div class="audit-list" id="auditList" style="margin-top:20px"></div></section>

    <section class="panel" aria-labelledby="limitsTitle"><div class="section-head"><h2 id="limitsTitle">解读限制</h2></div><ul class="limitations" id="limitations"></ul></section>
    <p class="footer">仅允许研究、观察和比较；禁止创建订单或自动交易。本报告不构成投资建议。</p>
  </main>
  <script>
    const report=${payload};
    const colors=['#123f68','#b56b08','#087b72'];
    let mode='costInclusive';
    const html=(value)=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const percent=(value)=>Number(value).toFixed(2)+'%';
    const money=(value)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
    const uniqueEvents=(trades)=>new Set(trades.filter((trade)=>trade.reason==='drift_rebalance').map((trade)=>trade.decisionDate)).size;
    const selectedRecommendation=()=>report.recommendation[mode];
    document.getElementById('periodText').textContent=report.dataBasis.effectivePeriod.startDate+' 至 '+report.dataBasis.effectivePeriod.endDate+' · '+report.dataBasis.effectivePeriod.tradingDays+'个共同净值日';
    document.getElementById('hashText').textContent='数据指纹 '+report.dataBasis.sourceHash.slice(0,12);
    document.getElementById('limitations').innerHTML=report.limitations.map((item)=>'<li>'+html(item)+'</li>').join('');
    document.getElementById('auditList').innerHTML=report.dataBasis.targetSeries.map((item)=>'<div class="audit-row"><strong>'+html(item.symbol)+'</strong><span>'+html(item.name)+' · '+html(item.sources.join(', '))+'</span><span>'+item.bars+'条</span><span>'+html(item.firstDate)+' → '+html(item.lastDate)+'</span></div>').join('');
    function renderRecommendation(){const item=selectedRecommendation();document.getElementById('recommendationTitle').textContent=item.headline;document.getElementById('recommendationSummary').textContent=item.summary;document.getElementById('recommendationEvidence').innerHTML=item.evidence.map((text)=>'<div>'+html(text)+'</div>').join('')}
    function renderMetrics(){const recommendation=selectedRecommendation();const baseline=report.scenarios.find((item)=>item.thresholdPercentagePoints===3)[mode].metrics;document.getElementById('modeLabel').textContent=mode==='costInclusive'?'当前口径：费率+滑点压力':'当前口径：用户确认免费转换';document.getElementById('metricGrid').innerHTML=report.scenarios.map((scenario)=>{const metrics=scenario[mode].metrics;return '<article class="metric"><span class="label">'+html(scenario.label)+'</span><strong>'+percent(metrics.totalReturnPercent)+'</strong><span class="detail">最大回撤 '+percent(metrics.maxDrawdownPercent)+' · 再平衡 '+uniqueEvents(scenario[mode].trades)+' 次</span></article>'}).join('');document.getElementById('comparisonRows').innerHTML=report.scenarios.map((scenario)=>{const metrics=scenario[mode].metrics;const selected=scenario.thresholdPercentagePoints===recommendation.selectedThresholdPercentagePoints;const returnClass=metrics.totalReturnPercent>baseline.totalReturnPercent+.0001?'better':metrics.totalReturnPercent<baseline.totalReturnPercent-.0001?'worse':'';const ddClass=metrics.maxDrawdownPercent>baseline.maxDrawdownPercent+.0001?'better':metrics.maxDrawdownPercent<baseline.maxDrawdownPercent-.0001?'worse':'';return '<tr class="'+(selected?'selected-row':'')+'"><td><strong>'+scenario.thresholdPercentagePoints+'%</strong>'+(selected?' · 研究倾向':'')+'</td><td class="number '+returnClass+'">'+percent(metrics.totalReturnPercent)+'</td><td class="number">'+percent(metrics.annualizedReturnPercent)+'</td><td class="number '+ddClass+'">'+percent(metrics.maxDrawdownPercent)+'</td><td class="number">'+percent(metrics.monthlyMaxDrawdownPercent)+'</td><td class="number">'+uniqueEvents(scenario[mode].trades)+'</td><td class="number">'+money(metrics.rebalanceTurnoverCny)+'</td><td class="number">'+money(metrics.totalCostCny)+'</td></tr>'}).join('')}
    function renderTrades(){const rows=report.scenarios.flatMap((scenario)=>scenario[mode].trades.filter((trade)=>trade.reason==='drift_rebalance').map((trade)=>({threshold:scenario.thresholdPercentagePoints,...trade})));document.getElementById('tradeRows').innerHTML=rows.length?rows.map((trade)=>'<tr><td>'+trade.threshold+'%</td><td>'+html(trade.decisionDate)+' → '+html(trade.executionDate)+'</td><td class="'+(trade.side==='BUY'?'better':'worse')+'">'+(trade.side==='BUY'?'买入':'卖出')+'</td><td>'+html(trade.symbol+' '+trade.name)+'</td><td class="number">'+money(trade.grossAmount)+'</td><td class="number">'+money(trade.cost)+'</td></tr>').join(''):'<tr><td colspan="6">本年度三个阈值均未产生偏离再平衡交易。</td></tr>'}
    function chartTheme(){const css=getComputedStyle(document.body);return{ink:css.getPropertyValue('--ink').trim(),muted:css.getPropertyValue('--muted').trim(),line:css.getPropertyValue('--line').trim(),surface:css.getPropertyValue('--surface').trim()}}
    function drawChart(canvas,key,readoutId){const context=canvas.getContext('2d');const box=canvas.getBoundingClientRect();const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(box.width*ratio));canvas.height=Math.max(1,Math.round(box.height*ratio));context.setTransform(ratio,0,0,ratio,0,0);const width=box.width,height=box.height,pad={left:52,right:14,top:16,bottom:30};const theme=chartTheme();const series=report.scenarios.map((scenario)=>({label:scenario.label,points:scenario[mode].curve.map((point)=>({date:point.date,value:key==='netValue'?point.netValue*100:point.drawdownPercent}))}));const values=series.flatMap((item)=>item.points.map((point)=>point.value));let min=Math.min(...values),max=Math.max(...values);if(key==='netValue'){const extra=Math.max(.4,(max-min)*.12);min-=extra;max+=extra}else{min=Math.min(min-.3,-1);max=.3}const range=Math.max(.1,max-min);context.clearRect(0,0,width,height);context.strokeStyle=theme.line;context.fillStyle=theme.muted;context.font='12px Microsoft YaHei';context.lineWidth=1;for(let index=0;index<=4;index+=1){const y=pad.top+(height-pad.top-pad.bottom)*index/4;context.beginPath();context.moveTo(pad.left,y);context.lineTo(width-pad.right,y);context.stroke();const value=max-range*index/4;context.fillText((key==='netValue'?value.toFixed(1):value.toFixed(1)+'%'),4,y+4)}const dates=series[0].points;context.fillText(dates[0].date,pad.left,height-8);const endText=dates[dates.length-1].date;context.fillText(endText,width-pad.right-context.measureText(endText).width,height-8);series.forEach((item,seriesIndex)=>{context.strokeStyle=colors[seriesIndex];context.lineWidth=seriesIndex===0?3:2;context.beginPath();item.points.forEach((point,index)=>{const x=pad.left+(width-pad.left-pad.right)*index/Math.max(1,item.points.length-1);const y=pad.top+(height-pad.top-pad.bottom)*(max-point.value)/range;if(index===0)context.moveTo(x,y);else context.lineTo(x,y)});context.stroke()});canvas.onpointermove=(event)=>{const rect=canvas.getBoundingClientRect();const position=Math.max(0,Math.min(1,(event.clientX-rect.left-pad.left)/Math.max(1,width-pad.left-pad.right)));const index=Math.round(position*(dates.length-1));document.getElementById(readoutId).textContent=dates[index].date+' · '+series.map((item)=>item.label+' '+(key==='netValue'?(item.points[index].value-100).toFixed(2)+'%':item.points[index].value.toFixed(2)+'%')).join(' · ')}}
    function renderLegends(){const markup=report.scenarios.map((scenario,index)=>'<span><i class="swatch" style="background:'+colors[index]+'"></i>'+html(scenario.label)+'</span>').join('');document.getElementById('returnLegend').innerHTML=markup;document.getElementById('drawdownLegend').innerHTML=markup}
    function drawAll(){drawChart(document.getElementById('returnChart'),'netValue','returnReadout');drawChart(document.getElementById('drawdownChart'),'drawdown','drawdownReadout')}
    function render(){renderRecommendation();renderMetrics();renderTrades();renderLegends();requestAnimationFrame(drawAll)}
    document.getElementById('costToggle').addEventListener('click',(event)=>{mode=mode==='costInclusive'?'freeConversion':'costInclusive';event.currentTarget.setAttribute('aria-pressed',String(mode==='costInclusive'));event.currentTarget.textContent=mode==='costInclusive'?'含费压力':'免费转换';render()});
    document.getElementById('themeToggle').addEventListener('click',(event)=>{const dark=document.body.dataset.theme!=='dark';document.body.dataset.theme=dark?'dark':'light';event.currentTarget.setAttribute('aria-pressed',String(dark));event.currentTarget.textContent=dark?'浅色模式':'深色模式';localStorage.setItem('fams-threshold-theme',dark?'dark':'light');requestAnimationFrame(drawAll)});
    document.getElementById('densityToggle').addEventListener('click',(event)=>{const compact=document.body.dataset.density!=='compact';document.body.dataset.density=compact?'compact':'comfortable';event.currentTarget.setAttribute('aria-pressed',String(compact));event.currentTarget.textContent=compact?'舒适视图':'紧凑视图';requestAnimationFrame(drawAll)});
    if(localStorage.getItem('fams-threshold-theme')==='dark'){document.body.dataset.theme='dark';const button=document.getElementById('themeToggle');button.setAttribute('aria-pressed','true');button.textContent='浅色模式'}
    new ResizeObserver(()=>drawAll()).observe(document.querySelector('.charts'));
    render();
  </script>
</body>
</html>`
}
