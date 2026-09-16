import type { AlipayPortfolioComparisonStudy, ComparisonStrategy } from './alipayPortfolioComparisonService.js'

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const percent = (value: number | null | undefined, digits = 2) => value === null || value === undefined
  ? '—'
  : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`

const money = (value: number | null | undefined) => value === null || value === undefined
  ? '—'
  : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(value)

const statusLabel = (status: ComparisonStrategy['status']) => status === 'completed' ? '可比较' : '证据不足'
const proxyRiskLabel = (risk: 'none' | 'low' | 'medium' | 'high') => ({
  none: '无', low: '低', medium: '中', high: '高',
})[risk]

export type AlipayPortfolioComparisonSupplement = {
  rollingWindowTradingDays: number
  rollingWindowCount: number
  averageContinuousAnnualizedReturnPercent: number
  averageRestartAnnualizedReturnPercent: number
  meanAbsoluteRestartDifferencePercentagePoints: number
  maximumAbsoluteRestartDifferencePercentagePoints: number
  maximumDifferenceWindow: { startDate: string; endDate: string }
}

export function renderAlipayPortfolioComparisonHtml(study: AlipayPortfolioComparisonStudy, options: {
  operationId?: string
  pageTitle?: string
  supplement?: AlipayPortfolioComparisonSupplement
} = {}) {
  const strategyById = new Map(study.strategies.map((item) => [item.strategyId, item]))
  const main = study.strategies.find((item) => item.group === 'target')!
  const horizonLabel = study.period.requestedYears === 3 ? '三年' : `近${study.period.requestedYears}年`
  const fullMonths = study.period.requestedYears * 12
  const strategyCount = study.strategies.length
  const pageTitle = options.pageTitle || `支付宝持仓${horizonLabel}组合对比回测`
  const targetWeights = study.frozenRules.targetBucketWeights
  const targetWeightLabel = `${targetWeights.cash}/${targetWeights.gold}/${targetWeights.bond}/${targetWeights.equity}`
  const supplement = options.supplement
  const bestReturn = study.ranking.bestAnnualizedReturnStrategyId ? strategyById.get(study.ranking.bestAnnualizedReturnStrategyId) : null
  const lowestDrawdown = study.ranking.lowestMonthlyDrawdownStrategyId ? strategyById.get(study.ranking.lowestMonthlyDrawdownStrategyId) : null
  const colorById = Object.fromEntries(study.strategies.map((strategy, index) => [strategy.strategyId, [
    '#1d4ed8', '#475569', '#b45309', '#a16207', '#0f766e', '#0369a1', '#7c3aed', '#be123c', '#0e7490', '#4d7c0f',
  ][index % 10]]))

  const metricRows = study.strategies.map((strategy, index) => `
    <tr data-strategy-row="${escapeHtml(strategy.strategyId)}" data-group="${strategy.group}">
      <td class="rank">${index + 1}</td>
      <td class="strategy-cell">
        <button class="legend-toggle is-active" type="button" data-strategy="${escapeHtml(strategy.strategyId)}" aria-pressed="true">
          <span class="legend-dot" style="--series:${colorById[strategy.strategyId]}"></span>
          <span><strong>${escapeHtml(strategy.displayName)}</strong><small>${escapeHtml(strategy.policyLabel)}</small></span>
        </button>
      </td>
      <td><span class="status ${strategy.status}">${statusLabel(strategy.status)}</span></td>
      <td class="number ${strategy.metrics.annualizedReturnPercent >= 0 ? 'up' : 'down'}">${percent(strategy.metrics.annualizedReturnPercent)}</td>
      <td class="number">${percent(strategy.metrics.monthlyMaxDrawdownPercent)}</td>
      <td class="number">${percent(strategy.metrics.maxDrawdownPercent)}</td>
      <td class="number optional">${percent(strategy.metrics.worstMonthlyReturnPercent)}</td>
      <td class="number optional">${strategy.metrics.sharpe?.toFixed(2) ?? '—'}</td>
      <td class="number optional">${strategy.metrics.calmar?.toFixed(2) ?? '—'}</td>
      <td class="number optional">${strategy.metrics.tradeCount}</td>
      <td class="number optional">${money(strategy.metrics.totalCostCny)}</td>
      <td class="number optional">${strategy.costStressMetrics ? percent(strategy.costStressMetrics.annualizedReturnPercent) : '同基础'}</td>
      <td class="number optional">${percent(strategy.proxyCoveragePercent)}</td>
    </tr>`).join('')

  const comparisonCards = study.conclusion.mainVersusComparators.map((item) => `
    <article class="comparison-card ${item.judgment}">
      <div class="comparison-top"><strong>${escapeHtml(item.comparatorName)}</strong><span>${item.judgment === 'dominates' ? '主组合双优' : item.judgment === 'lags' ? '主组合双弱' : '收益/风险交换'}</span></div>
      <p>${escapeHtml(item.summary)}</p>
      <dl><div><dt>年化差</dt><dd>${percent(item.annualizedReturnDifferencePercentagePoints)}</dd></div><div><dt>月回撤差</dt><dd>${percent(item.monthlyDrawdownDifferencePercentagePoints)}</dd></div></dl>
    </article>`).join('')

  const strategyDetails = study.strategies.map((strategy) => `
    <details class="strategy-detail" data-detail-group="${strategy.group}">
      <summary><span class="legend-dot" style="--series:${colorById[strategy.strategyId]}"></span><strong>${escapeHtml(strategy.displayName)}</strong><span>${percent(strategy.metrics.annualizedReturnPercent)} / 月回撤 ${percent(strategy.metrics.monthlyMaxDrawdownPercent)}</span></summary>
      <div class="detail-body">
        <div>
          <h3>代码、名称与目标权重</h3>
          <div class="component-list">${strategy.components.map((component) => `<div><code>${escapeHtml(component.symbol)}</code><span>${escapeHtml(component.name)}</span><strong>${component.targetWeightPercent.toFixed(3)}%</strong></div>`).join('')}</div>
        </div>
        <div>
          <h3>触发统计</h3>
          <div class="trigger-grid">
            <span>偏离再平衡<strong>${strategy.triggerCounts.drift}</strong></span>
            <span>网格买入<strong>${strategy.triggerCounts.gridBuy}</strong></span>
            <span>网格卖出<strong>${strategy.triggerCounts.gridSell}</strong></span>
            <span>止盈<strong>${strategy.triggerCounts.takeProfit}</strong></span>
            <span>止损<strong>${strategy.triggerCounts.stopLoss}</strong></span>
            <span>次月再入<strong>${strategy.triggerCounts.reentry}</strong></span>
          </div>
        </div>
        <div class="detail-wide">
          <h3>限制与解释</h3>
          <ul>${strategy.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
        </div>
      </div>
    </details>`).join('')

  const dataRows = study.dataAudit.items.map((item) => `
    <tr>
      <td><code>${escapeHtml(item.symbol)}</code></td><td>${escapeHtml(item.name)}</td><td>${item.bars}</td>
      <td>${escapeHtml(item.firstDate)} ~ ${escapeHtml(item.lastDate)}</td><td>${item.directBars}</td><td>${item.proxyBars}</td>
      <td>${item.proxySymbols.length ? item.proxySymbols.map((symbol) => `<code>${escapeHtml(symbol)}</code>`).join(' → ') : '—'}</td><td>${escapeHtml(item.proxyMethod || '—')}</td><td>${escapeHtml(proxyRiskLabel(item.proxyRisk))}</td><td>${escapeHtml(item.sources.join(' / '))}</td>
      <td><span class="status ${item.status === 'passed' ? 'completed' : 'insufficient'}">${item.status === 'passed' ? '通过' : '不足'}</span></td>
    </tr>`).join('')

  const directSensitivityRows = study.sensitivity.directHistoryOnly.strategies.map((item) => `
    <tr><td>${escapeHtml(item.displayName)}</td><td class="number">${percent(item.annualizedReturnPercent)}</td><td class="number">${percent(item.differenceFromPrimaryAnnualizedPercentagePoints)}</td><td class="number">${percent(item.monthlyMaxDrawdownPercent)}</td><td class="number">${percent(item.differenceFromPrimaryMonthlyDrawdownPercentagePoints)}</td></tr>`).join('')

  const displayStudy = {
    ...study,
    sourceSnapshot: {
      ...study.sourceSnapshot,
      series: {},
    },
  }
  const serialized = JSON.stringify({ study: displayStudy, colorById, operationId: options.operationId || null, supplement: supplement || null }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN" data-theme="light" data-density="full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    :root{--primary:#1d4ed8;--primary-soft:#dbeafe;--ink:#0f172a;--text:#334155;--muted:#64748b;--bg:#eef3f8;--card:#fff;--subtle:#f8fafc;--border:#dbe3ef;--up:#b91c1c;--down:#047857;--warn:#a16207;--shadow:0 8px 24px rgba(15,23,42,.08)}
    html[data-theme="dark"]{--primary:#60a5fa;--primary-soft:#172554;--ink:#f8fafc;--text:#cbd5e1;--muted:#94a3b8;--bg:#0f172a;--card:#172033;--subtle:#111827;--border:#334155;--up:#f87171;--down:#34d399;--warn:#fbbf24;--shadow:0 8px 28px rgba(0,0,0,.28)}
    *{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font-family:'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif}body{margin:0;background:var(--bg);font-size:16px;line-height:1.55}button{font:inherit}.page{width:min(1500px,100%);margin:0 auto;padding:24px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.eyebrow{color:var(--primary);font-size:13px;font-weight:700;letter-spacing:.08em}.topbar h1{margin:4px 0 0;font-size:clamp(24px,3vw,38px);line-height:1.2;text-wrap:pretty}.toolbar{display:flex;flex-wrap:wrap;gap:8px}.tool-button,.group-button{min-height:44px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);padding:9px 13px;cursor:pointer}.tool-button:hover,.tool-button:focus-visible,.group-button:hover,.group-button:focus-visible{border-color:var(--primary);outline:3px solid color-mix(in srgb,var(--primary) 20%,transparent)}.hero{display:grid;grid-template-columns:1.45fr .85fr;gap:16px}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}.hero-copy{padding:24px}.confidence{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:#fef3c7;color:#854d0e;padding:6px 10px;font-size:13px;font-weight:700}.hero-copy h2{font-size:clamp(22px,2.5vw,34px);line-height:1.25;margin:16px 0 12px;text-wrap:pretty}.hero-copy p{color:var(--text);margin:0;max-width:900px}.rule-line{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.rule-line span{background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px}.hero-metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);overflow:hidden}.hero-metric{background:var(--card);padding:20px}.hero-metric span{display:block;color:var(--muted);font-size:13px}.hero-metric strong{display:block;margin-top:7px;font-size:clamp(22px,2.5vw,31px);font-variant-numeric:tabular-nums}.up{color:var(--up)}.down{color:var(--down)}.section{margin-top:16px;padding:20px}.section-header{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:16px}.section h2{margin:0;font-size:21px}.section-note{color:var(--muted);font-size:13px}.comparison-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.comparison-card{border:1px solid var(--border);border-radius:10px;background:var(--subtle);padding:15px}.comparison-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.comparison-top strong{font-size:14px}.comparison-top span{white-space:nowrap;color:var(--primary);font-size:12px;font-weight:700}.comparison-card p{color:var(--text);font-size:13px;min-height:42px}.comparison-card dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}.comparison-card dl div{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px}.comparison-card dt{color:var(--muted);font-size:11px}.comparison-card dd{margin:2px 0 0;font-weight:700;font-variant-numeric:tabular-nums}.charts{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}.chart-card{padding:18px;min-width:0}.chart-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.chart-title h2{font-size:18px;margin:0}.chart-wrap{position:relative;width:100%;height:390px}.chart-wrap.small{height:280px}canvas{display:block;width:100%;height:100%}.chart-empty{display:none;position:absolute;inset:0;align-items:center;justify-content:center;color:var(--muted)}.filter-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.group-button.is-active{background:var(--primary-soft);border-color:var(--primary);color:var(--primary);font-weight:700}.table-shell{overflow-x:auto;border:1px solid var(--border);border-radius:10px}.metric-table,.data-table{width:100%;border-collapse:collapse;min-width:1150px}.metric-table th,.metric-table td,.data-table th,.data-table td{padding:11px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:middle}.metric-table th,.data-table th{position:sticky;top:0;background:var(--subtle);color:var(--muted);font-size:12px;z-index:1}.metric-table tbody tr:hover,.data-table tbody tr:hover{background:var(--subtle)}.number{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}.rank{color:var(--muted);width:42px}.strategy-cell{min-width:300px}.legend-toggle{display:flex;align-items:flex-start;gap:9px;border:0;background:transparent;color:var(--ink);padding:3px;cursor:pointer;text-align:left}.legend-toggle small{display:block;color:var(--muted);font-size:11px;margin-top:2px;max-width:360px}.legend-toggle:not(.is-active){opacity:.42}.legend-dot{width:10px;height:10px;flex:0 0 auto;border-radius:3px;background:var(--series);margin-top:5px}.status{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700}.status.completed{background:#dcfce7;color:#166534}.status.insufficient{background:#fee2e2;color:#991b1b}.strategy-detail{border:1px solid var(--border);border-radius:10px;background:var(--card);margin-bottom:8px}.strategy-detail summary{display:grid;grid-template-columns:auto minmax(220px,1fr) auto;align-items:center;gap:10px;min-height:48px;padding:9px 13px;cursor:pointer}.strategy-detail summary span:last-child{color:var(--muted);font-size:13px}.detail-body{display:grid;grid-template-columns:1fr 1fr;gap:18px;border-top:1px solid var(--border);padding:16px}.detail-body h3{font-size:14px;margin:0 0 9px}.detail-wide{grid-column:1/-1}.component-list{display:grid;gap:6px}.component-list div{display:grid;grid-template-columns:90px 1fr auto;gap:8px;align-items:center;background:var(--subtle);border-radius:7px;padding:7px 9px;font-size:13px}.component-list code,.data-table code{color:var(--primary);font-weight:700}.trigger-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.trigger-grid span{display:flex;flex-direction:column;background:var(--subtle);border-radius:7px;padding:8px;color:var(--muted);font-size:11px}.trigger-grid strong{color:var(--ink);font-size:18px}.detail-body ul{margin:0;padding-left:20px;color:var(--text);font-size:13px}.risk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.risk-box{background:var(--subtle);border:1px solid var(--border);border-radius:10px;padding:14px}.risk-box h3{margin:0 0 8px;font-size:15px}.risk-box ul{margin:0;padding-left:19px;color:var(--text);font-size:13px}.method{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.method div{background:var(--subtle);border:1px solid var(--border);border-radius:9px;padding:12px}.method strong{display:block;color:var(--primary);font-size:13px}.method span{display:block;color:var(--text);font-size:12px;margin-top:4px}.footer{padding:22px 0 10px;color:var(--muted);font-size:12px;text-align:center}.full-only{display:block}html[data-density="compact"] .optional,html[data-density="compact"] .detail-section,html[data-density="compact"] .data-section{display:none}html[data-density="compact"] .comparison-grid{grid-template-columns:repeat(2,1fr)}
    .window-controls{display:grid;gap:14px}.window-presets,.window-modes{display:flex;flex-wrap:wrap;gap:8px}.window-range{display:grid;grid-template-columns:1fr 1fr;gap:12px}.window-range label{display:grid;gap:5px;color:var(--muted);font-size:12px}.window-range input{width:100%;accent-color:var(--primary)}.window-dates{display:flex;justify-content:space-between;gap:12px;font-weight:700;font-variant-numeric:tabular-nums}.window-status{min-height:24px;color:var(--muted);font-size:13px}.window-status.error{color:var(--up)}.window-summary{display:grid;grid-template-columns:1fr 1fr;gap:12px}.window-summary article{border:1px solid var(--border);border-radius:10px;background:var(--subtle);padding:14px}.window-summary h3{margin:0 0 8px;font-size:15px}.window-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.window-kpis span{background:var(--card);border:1px solid var(--border);border-radius:7px;padding:8px;color:var(--muted);font-size:11px}.window-kpis strong{display:block;color:var(--ink);font-size:18px}.window-table{min-width:850px}.mode-button.is-active{background:var(--primary);border-color:var(--primary);color:#fff}
    @media(max-width:1080px){.hero,.charts{grid-template-columns:1fr}.comparison-grid{grid-template-columns:repeat(2,1fr)}.method{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:680px){body{font-size:15px}.page{padding:12px}.topbar{align-items:flex-start;flex-direction:column}.hero-copy,.section{padding:16px}.hero-metrics{grid-template-columns:1fr 1fr}.comparison-grid,html[data-density="compact"] .comparison-grid,.risk-grid,.detail-body,.method,.window-summary,.window-range{grid-template-columns:1fr}.detail-wide{grid-column:auto}.chart-wrap{height:310px}.chart-wrap.small{height:250px}.strategy-detail summary{grid-template-columns:auto 1fr}.strategy-detail summary span:last-child{grid-column:2}.trigger-grid,.window-kpis{grid-template-columns:repeat(2,1fr)}.section-header{align-items:flex-start;flex-direction:column}.toolbar{width:100%}.tool-button{flex:1}.hero-metric{padding:14px}.comparison-card p{min-height:0}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <div><div class="eyebrow">FAMS · REAL-DATA RESEARCH</div><h1>${escapeHtml(pageTitle)}</h1></div>
      <div class="toolbar"><button class="tool-button" id="densityButton" type="button">切换精简视图</button><button class="tool-button" id="themeButton" type="button">切换深色</button></div>
    </header>

    <section class="hero">
      <article class="card hero-copy">
        <span class="confidence">研究置信度：低</span>
        <h2>${escapeHtml(study.conclusion.headline)}</h2>
        <p>这是${horizonLabel}历史样本的风险收益比较，不是收益预测。主组合只有在收益更高且回撤更小时才标记为“双优”；成立前代理比例和风险必须与收益结果一起看。</p>
        <div class="rule-line"><span>${escapeHtml(study.period.startDate)} 至 ${escapeHtml(study.period.endDate)}</span><span>${study.period.tradingDays}个共同交易日</span><span>初始资金 ${money(study.snapshot.initialCapital)}</span><span>目标 现金/黄金/债券/权益 = ${escapeHtml(targetWeightLabel)}</span><span>偏离严格&gt;${study.frozenRules.driftThresholdPercentagePoints}个百分点</span></div>
      </article>
      <article class="card hero-metrics">
        <div class="hero-metric"><span>主组合年化</span><strong class="${main.metrics.annualizedReturnPercent >= 0 ? 'up' : 'down'}">${percent(main.metrics.annualizedReturnPercent)}</strong></div>
        <div class="hero-metric"><span>主组合月末最大回撤</span><strong>${percent(main.metrics.monthlyMaxDrawdownPercent)}</strong></div>
        <div class="hero-metric"><span>年化最高</span><strong>${bestReturn ? percent(bestReturn.metrics.annualizedReturnPercent) : '—'}</strong><span>${escapeHtml(bestReturn?.displayName || '')}</span></div>
        <div class="hero-metric"><span>月回撤最小</span><strong>${lowestDrawdown ? percent(lowestDrawdown.metrics.monthlyMaxDrawdownPercent) : '—'}</strong><span>${escapeHtml(lowestDrawdown?.displayName || '')}</span></div>
      </article>
    </section>

    ${supplement ? `<section class="card section">
      <div class="section-header"><div><h2>${horizonLabel}平均年化与重启敏感性</h2><div class="section-note">使用${supplement.rollingWindowTradingDays}个共同交易日的滚动窗口；“敏感性”是连续路径与窗口首日重启年化差的平均绝对值。</div></div><span class="status completed">${supplement.rollingWindowCount}个窗口</span></div>
      <div class="method">
        <div><strong>滚动平均持续年化</strong><span>${percent(supplement.averageContinuousAnnualizedReturnPercent)}</span></div>
        <div><strong>滚动平均重启年化</strong><span>${percent(supplement.averageRestartAnnualizedReturnPercent)}</span></div>
        <div><strong>平均重启敏感性</strong><span>${supplement.meanAbsoluteRestartDifferencePercentagePoints.toFixed(2)}个百分点</span></div>
        <div><strong>最坏重启敏感性</strong><span>${supplement.maximumAbsoluteRestartDifferencePercentagePoints.toFixed(2)}个百分点 · ${escapeHtml(supplement.maximumDifferenceWindow.startDate)} 至 ${escapeHtml(supplement.maximumDifferenceWindow.endDate)}</span></div>
      </div>
    </section>` : ''}

    <section class="card section">
      <div class="section-header"><div><h2>主组合与当前持仓、三个单品</h2><div class="section-note">正的“月回撤差”表示主组合回撤更浅。</div></div><span class="status completed">${study.status === 'completed' ? `${strategyCount}组均可比较` : '存在证据不足'}</span></div>
      <div class="comparison-grid">${comparisonCards}</div>
    </section>

    <section class="card section" id="windowSection">
      <div class="section-header"><div><h2>滑动时间窗对比</h2><div class="section-note">连续切片保留此前状态；窗口重启从所选开始日重新建仓。两者同时计算，不混为一种结果。</div></div><span class="status completed" id="windowDays">准备计算</span></div>
      <div class="window-controls">
        <div class="window-presets" aria-label="时间窗快捷选择"><button class="group-button preset-button" data-months="3" type="button">近3月</button><button class="group-button preset-button" data-months="6" type="button">近6月</button><button class="group-button preset-button" data-months="12" type="button">近12月</button><button class="group-button preset-button" data-months="24" type="button">近24月</button><button class="group-button preset-button" data-months="36" type="button">近36月</button><button class="group-button preset-button is-active" data-months="${fullMonths}" type="button">完整${fullMonths}月</button></div>
        <div class="window-dates"><span id="windowStartDate">${escapeHtml(study.period.startDate)}</span><span id="windowEndDate">${escapeHtml(study.period.endDate)}</span></div>
        <div class="window-range"><label>窗口开始<input id="windowStart" type="range" min="0" max="${Math.max(0, study.sourceSnapshot.commonDates.length - 1)}" value="0" aria-label="窗口开始交易日"></label><label>窗口结束<input id="windowEnd" type="range" min="0" max="${Math.max(0, study.sourceSnapshot.commonDates.length - 1)}" value="${Math.max(0, study.sourceSnapshot.commonDates.length - 1)}" aria-label="窗口结束交易日"></label></div>
        <div class="window-status" id="windowStatus" role="status">正在计算完整区间的双口径结果…</div>
        <div class="window-summary"><article><h3>连续路径切片</h3><div class="window-kpis" id="continuousKpis"><span>年化<strong>—</strong></span><span>月末回撤<strong>—</strong></span><span>总收益<strong>—</strong></span></div></article><article><h3>窗口首日重新建仓</h3><div class="window-kpis" id="restartKpis"><span>年化<strong>—</strong></span><span>月末回撤<strong>—</strong></span><span>总收益<strong>—</strong></span></div></article></div>
        <div class="window-modes" aria-label="曲线显示口径"><button class="group-button mode-button is-active" data-mode="continuous" type="button">图表显示连续切片</button><button class="group-button mode-button" data-mode="restart" type="button">图表显示窗口重启</button></div>
        <div class="table-shell"><table class="metric-table window-table"><thead><tr><th>策略</th><th class="number">连续年化</th><th class="number">重启年化</th><th class="number">连续月回撤</th><th class="number">重启月回撤</th><th class="number">连续总收益</th><th class="number">重启总收益</th></tr></thead><tbody id="windowTableBody"><tr><td colspan="7">正在计算…</td></tr></tbody></table></div>
      </div>
    </section>

    <section class="charts">
      <article class="card chart-card"><div class="chart-title"><h2>所选时间窗归一化净值</h2><span class="section-note">点击下表策略名称可隐藏曲线</span></div><div class="chart-wrap"><canvas id="equityChart" aria-label="${strategyCount}组策略所选时间窗归一化净值曲线"></canvas><div class="chart-empty">请选择至少一组策略</div></div></article>
      <article class="card chart-card"><div class="chart-title"><h2>年化收益 / 月末回撤</h2><span class="section-note">越靠右上越理想</span></div><div class="chart-wrap small"><canvas id="riskChart" aria-label="策略风险收益散点图"></canvas></div></article>
    </section>

    <section class="card section">
      <div class="section-header"><div><h2>完整结果表</h2><div class="section-note">月度最大回撤使用每月最后一个净值点计算；同时保留日频最大回撤和最差单月。</div></div></div>
      <div class="filter-row"><button class="group-button is-active" data-group="all" type="button">全部${strategyCount}组</button><button class="group-button" data-group="target" type="button">目标组合</button><button class="group-button" data-group="baseline" type="button">当前持仓</button><button class="group-button" data-group="single" type="button">三个单品</button><button class="group-button" data-group="classic" type="button">经典组合</button></div>
      <div class="table-shell"><table class="metric-table"><thead><tr><th>#</th><th>策略 / 规则</th><th>状态</th><th class="number">年化</th><th class="number">月末最大回撤</th><th class="number">日频最大回撤</th><th class="number optional">最差单月</th><th class="number optional">Sharpe</th><th class="number optional">Calmar</th><th class="number optional">交易数</th><th class="number optional">成本</th><th class="number optional">成本压力年化</th><th class="number optional">代理占比</th></tr></thead><tbody>${metricRows}</tbody></table></div>
    </section>

    <section class="card section detail-section"><div class="section-header"><div><h2>每组代码、名称和触发记录</h2><div class="section-note">展开查看组成，不需要从图例猜测基金代码。</div></div></div>${strategyDetails}</section>

    <section class="card section">
      <div class="section-header"><div><h2>为什么不能只看收益最高</h2><div class="section-note">${horizonLabel}样本、代理数据与资产分类共同限制结论强度。</div></div></div>
      <div class="risk-grid"><article class="risk-box"><h3>支持主组合的证据</h3><ul>${study.conclusion.bullCase.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article><article class="risk-box"><h3>反面证据与代价</h3><ul>${study.conclusion.bearCase.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article><article class="risk-box"><h3>需要推翻结论的条件</h3><ul>${study.conclusion.thesisBreakers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article></div>
    </section>

    <section class="card section data-section">
      <div class="section-header"><div><h2>真实数据和代理审计</h2><div class="section-note">基金为本地Eastmoney累计净值；ETF为腾讯前复权日线；豆粕上市前为新浪连续合约。代理日期不会覆盖基金成立后的真实净值。</div></div><span class="status ${study.dataAudit.status === 'passed' ? 'completed' : 'insufficient'}">数据门槛${study.dataAudit.status === 'passed' ? '通过' : '未通过'}</span></div>
      <div class="table-shell"><table class="data-table"><thead><tr><th>代码</th><th>名称</th><th>共同样本</th><th>区间</th><th>真实日数</th><th>代理日数</th><th>代理链</th><th>方法</th><th>风险</th><th>来源</th><th>状态</th></tr></thead><tbody>${dataRows}</tbody></table></div>
      <div class="section-header" style="margin-top:22px"><div><h2>不使用代理的敏感度</h2><div class="section-note">${escapeHtml(study.sensitivity.directHistoryOnly.startDate)} 至 ${escapeHtml(study.sensitivity.directHistoryOnly.endDate)}，${study.sensitivity.directHistoryOnly.tradingDays}个共同净值日。${escapeHtml(study.sensitivity.directHistoryOnly.warning)}</div></div></div>
      <div class="table-shell"><table class="data-table"><thead><tr><th>策略</th><th class="number">直接历史年化</th><th class="number">较${horizonLabel}主结果</th><th class="number">直接历史月回撤</th><th class="number">较${horizonLabel}主结果</th></tr></thead><tbody>${directSensitivityRows}</tbody></table></div>
    </section>

    <section class="card section"><div class="section-header"><div><h2>固定计算口径</h2><div class="section-note">这些参数在读取结果前冻结，没有按历史最优值调参。</div></div></div><div class="method"><div><strong>主组合再平衡</strong><span>四桶任一绝对偏离严格超过${study.frozenRules.driftThresholdPercentagePoints}个百分点，下一有效净值恢复全部目标。</span></div><div><strong>单品网格</strong><span>初始85/15；相对上次成交每±3%交易初始资金3%，每日最多一档。</span></div><div><strong>止盈止损</strong><span>相对本轮入场达到+10%/-10%时下一净值清仓，次月首个净值日再入。</span></div><div><strong>月度回撤</strong><span>每月最后一个有效净值组成月末序列，再计算峰值至谷值最大跌幅。</span></div></div></section>

    <footer class="footer">生成于 ${escapeHtml(study.generatedAt)} · 仅允许 RESEARCH / OBSERVE / COMPARE · 禁止 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE</footer>
  </main>
  <script>
    const payload=${serialized};
    const active=new Set(payload.study.strategies.map(item=>item.strategyId));
    let displayStrategies=payload.study.strategies;
    let windowResult=null;
    let chartMode='continuous';
    let windowRequestSequence=0;
    const densityButton=document.getElementById('densityButton');
    const themeButton=document.getElementById('themeButton');
    densityButton.addEventListener('click',()=>{const compact=document.documentElement.dataset.density==='compact';document.documentElement.dataset.density=compact?'full':'compact';densityButton.textContent=compact?'切换精简视图':'切换完整视图'});
    themeButton.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';themeButton.textContent=dark?'切换深色':'切换浅色';drawAll()});
    document.querySelectorAll('.legend-toggle').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.strategy;if(active.has(id)){active.delete(id);button.classList.remove('is-active');button.setAttribute('aria-pressed','false')}else{active.add(id);button.classList.add('is-active');button.setAttribute('aria-pressed','true')}drawAll()}));
    document.querySelectorAll('.group-button[data-group]').forEach(button=>button.addEventListener('click',()=>{const group=button.dataset.group;document.querySelectorAll('.group-button[data-group]').forEach(item=>item.classList.toggle('is-active',item===button));document.querySelectorAll('[data-strategy-row]').forEach(row=>row.hidden=group!=='all'&&row.dataset.group!==group);document.querySelectorAll('[data-detail-group]').forEach(row=>row.hidden=group!=='all'&&row.dataset.detailGroup!==group)}));
    const css=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const formatPercent=value=>value===null||value===undefined?'—':(value>0?'+':'')+Number(value).toFixed(2)+'%';
    const html=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    function canvasBox(canvas){const ratio=Math.min(2,window.devicePixelRatio||1);const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,width:rect.width,height:rect.height}}
    function drawAxes(ctx,w,h,pad,xTicks,yTicks,xLabel,yLabel){ctx.strokeStyle=css('--border');ctx.fillStyle=css('--muted');ctx.lineWidth=1;ctx.font="11px 'Microsoft YaHei'";for(let i=0;i<=4;i++){const y=pad.top+(h-pad.top-pad.bottom)*i/4;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();ctx.fillText(yTicks(i),5,y+4)}ctx.fillText(xLabel,pad.left,h-5);ctx.textAlign='right';ctx.fillText(yLabel,w-pad.right,h-5);ctx.textAlign='left'}
    function drawEquity(){const canvas=document.getElementById('equityChart');const {ctx,width:w,height:h}=canvasBox(canvas);ctx.clearRect(0,0,w,h);const chosen=displayStrategies.filter(item=>active.has(item.strategyId)&&item.curve.length);canvas.parentElement.querySelector('.chart-empty').style.display=chosen.length?'none':'flex';if(!chosen.length)return;const values=chosen.flatMap(item=>item.curve.map(p=>p.netValue));const min=Math.min(...values),max=Math.max(...values);const range=Math.max(.05,max-min);const pad={left:48,right:16,top:15,bottom:28};const curve=chosen[0].curve;drawAxes(ctx,w,h,pad,i=>(max-range*i/4).toFixed(2),()=>'',curve[0].date,curve[curve.length-1].date);chosen.forEach(item=>{ctx.strokeStyle=payload.colorById[item.strategyId];ctx.lineWidth=item.group==='target'?3:1.55;ctx.beginPath();item.curve.forEach((p,index)=>{const x=pad.left+(w-pad.left-pad.right)*index/Math.max(1,item.curve.length-1);const y=pad.top+(h-pad.top-pad.bottom)*(max-p.netValue)/range;if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke()})}
    function drawRisk(){const canvas=document.getElementById('riskChart');const {ctx,width:w,height:h}=canvasBox(canvas);ctx.clearRect(0,0,w,h);const chosen=displayStrategies.filter(item=>active.has(item.strategyId));if(!chosen.length)return;const xs=chosen.map(x=>Math.abs(x.metrics.monthlyMaxDrawdownPercent)),ys=chosen.map(x=>x.metrics.annualizedReturnPercent);const maxX=Math.max(5,...xs)*1.12,minY=Math.min(0,...ys)-2,maxY=Math.max(5,...ys)+2,rangeY=maxY-minY;const pad={left:48,right:18,top:16,bottom:30};drawAxes(ctx,w,h,pad,i=>(maxY-rangeY*i/4).toFixed(0)+'%',()=>'',Math.round(maxX)+'% 回撤','0%');chosen.forEach(item=>{const x=pad.left+(w-pad.left-pad.right)*(1-Math.abs(item.metrics.monthlyMaxDrawdownPercent)/maxX);const y=pad.top+(h-pad.top-pad.bottom)*(maxY-item.metrics.annualizedReturnPercent)/rangeY;ctx.fillStyle=payload.colorById[item.strategyId];ctx.beginPath();ctx.arc(x,y,item.group==='target'?7:5,0,Math.PI*2);ctx.fill();if(item.group==='target'){ctx.fillStyle=css('--ink');ctx.font="12px 'Microsoft YaHei'";ctx.fillText('主组合',Math.min(w-58,x+9),Math.max(14,y-8))}})}
    function drawAll(){drawEquity();drawRisk()}
    const dates=payload.study.sourceSnapshot.commonDates||[];
    const startRange=document.getElementById('windowStart');
    const endRange=document.getElementById('windowEnd');
    const startLabel=document.getElementById('windowStartDate');
    const endLabel=document.getElementById('windowEndDate');
    const statusNode=document.getElementById('windowStatus');
    const daysNode=document.getElementById('windowDays');
    const tableBody=document.getElementById('windowTableBody');
    const minimumWindowDays=20;
    function selectedDates(){return{startDate:dates[Number(startRange.value)]||payload.study.period.startDate,endDate:dates[Number(endRange.value)]||payload.study.period.endDate}}
    function updateWindowLabels(changed){let start=Number(startRange.value),end=Number(endRange.value);if(end-start+1<minimumWindowDays){if(changed==='start')start=Math.max(0,end-minimumWindowDays+1);else end=Math.min(dates.length-1,start+minimumWindowDays-1);startRange.value=String(start);endRange.value=String(end)}startLabel.textContent=dates[start]||'—';endLabel.textContent=dates[end]||'—';daysNode.textContent=Math.max(0,end-start+1)+'个交易日'}
    function mainStrategy(strategies){return strategies.find(item=>item.group==='target')||strategies[0]}
    function kpiMarkup(strategy){if(!strategy)return'<span>年化<strong>—</strong></span><span>月末回撤<strong>—</strong></span><span>总收益<strong>—</strong></span>';return'<span>年化<strong>'+formatPercent(strategy.metrics.annualizedReturnPercent)+'</strong></span><span>月末回撤<strong>'+formatPercent(strategy.metrics.monthlyMaxDrawdownPercent)+'</strong></span><span>总收益<strong>'+formatPercent(strategy.metrics.totalReturnPercent)+'</strong></span>'}
    function renderWindow(result){const continuous=result.continuousPath.strategies,restart=result.restartAtWindowStart.strategies;document.getElementById('continuousKpis').innerHTML=kpiMarkup(mainStrategy(continuous));document.getElementById('restartKpis').innerHTML=kpiMarkup(mainStrategy(restart));const restartById=new Map(restart.map(item=>[item.strategyId,item]));tableBody.innerHTML=continuous.map(item=>{const other=restartById.get(item.strategyId);return'<tr><td><span class="legend-dot" style="--series:'+html(payload.colorById[item.strategyId])+'"></span> '+html(item.displayName)+'</td><td class="number">'+formatPercent(item.metrics.annualizedReturnPercent)+'</td><td class="number">'+formatPercent(other&&other.metrics.annualizedReturnPercent)+'</td><td class="number">'+formatPercent(item.metrics.monthlyMaxDrawdownPercent)+'</td><td class="number">'+formatPercent(other&&other.metrics.monthlyMaxDrawdownPercent)+'</td><td class="number">'+formatPercent(item.metrics.totalReturnPercent)+'</td><td class="number">'+formatPercent(other&&other.metrics.totalReturnPercent)+'</td></tr>'}).join('');displayStrategies=chartMode==='restart'?restart:continuous;daysNode.textContent=result.effectivePeriod.tradingDays+'个交易日';statusNode.classList.remove('error');statusNode.textContent='已用持久化数据快照计算 · '+result.effectivePeriod.startDate+' 至 '+result.effectivePeriod.endDate+(result.sampleQuality==='short'?' · 短窗口，年化敏感':'');drawAll()}
    async function loadWindow(){updateWindowLabels();if(!payload.operationId){if(payload.supplement){const s=payload.supplement;statusNode.classList.remove('error');statusNode.textContent='静态报告已预计算'+s.rollingWindowCount+'个、每个'+s.rollingWindowTradingDays+'交易日的滚动窗口；任意自选窗口需从项目持久化入口打开。';startRange.disabled=true;endRange.disabled=true;document.getElementById('continuousKpis').innerHTML='<span>平均年化<strong>'+formatPercent(s.averageContinuousAnnualizedReturnPercent)+'</strong></span><span>窗口数<strong>'+s.rollingWindowCount+'</strong></span><span>敏感性<strong>'+Number(s.meanAbsoluteRestartDifferencePercentagePoints).toFixed(2)+'pp</strong></span>';document.getElementById('restartKpis').innerHTML='<span>平均年化<strong>'+formatPercent(s.averageRestartAnnualizedReturnPercent)+'</strong></span><span>最坏差异<strong>'+Number(s.maximumAbsoluteRestartDifferencePercentagePoints).toFixed(2)+'pp</strong></span><span>最坏窗口<strong>'+html(s.maximumDifferenceWindow.startDate)+'</strong></span>';tableBody.innerHTML='<tr><td>'+html(mainStrategy(payload.study.strategies).displayName)+'</td><td class="number">'+formatPercent(s.averageContinuousAnnualizedReturnPercent)+'</td><td class="number">'+formatPercent(s.averageRestartAnnualizedReturnPercent)+'</td><td class="number">—</td><td class="number">—</td><td class="number">—</td><td class="number">—</td></tr>'}else{statusNode.classList.add('error');statusNode.textContent='这是静态报告：请从项目“组合对比”入口打开已持久化运行，才能执行窗口重启计算。';tableBody.innerHTML='<tr><td colspan="7">静态报告未绑定运行记录，无法从相同数据快照重算。</td></tr>'}displayStrategies=payload.study.strategies;drawAll();return}const selection=selectedDates();const sequence=++windowRequestSequence;statusNode.classList.remove('error');statusNode.textContent='正在用同一份已保存数据计算双口径结果…';startRange.disabled=true;endRange.disabled=true;try{const response=await fetch('/api/v1/portfolio-backtest/alipay-comparison/runs/'+encodeURIComponent(payload.operationId)+'/window',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:payload.study.userId,startDate:selection.startDate,endDate:selection.endDate})});const result=await response.json();if(sequence!==windowRequestSequence)return;if(!response.ok)throw new Error(result.error||'window_request_failed');windowResult=result;renderWindow(result)}catch(error){if(sequence!==windowRequestSequence)return;statusNode.classList.add('error');statusNode.textContent='窗口计算失败：'+(error instanceof Error?error.message:String(error));tableBody.innerHTML='<tr><td colspan="7">未生成窗口结果，请调整到至少20个交易日后重试。</td></tr>'}finally{if(sequence===windowRequestSequence){startRange.disabled=false;endRange.disabled=false}}}
    startRange.addEventListener('input',()=>updateWindowLabels('start'));endRange.addEventListener('input',()=>updateWindowLabels('end'));startRange.addEventListener('change',loadWindow);endRange.addEventListener('change',loadWindow);
    document.querySelectorAll('.preset-button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.preset-button').forEach(item=>item.classList.toggle('is-active',item===button));const months=Number(button.dataset.months);const end=dates.length-1;const endDate=new Date((dates[end]||'1970-01-01')+'T00:00:00Z');endDate.setUTCMonth(endDate.getUTCMonth()-months);const boundary=endDate.toISOString().slice(0,10);let start=dates.findIndex(date=>date>=boundary);if(start<0)start=0;if(end-start+1<minimumWindowDays)start=Math.max(0,end-minimumWindowDays+1);startRange.value=String(start);endRange.value=String(end);updateWindowLabels();loadWindow()}));
    document.querySelectorAll('.mode-button').forEach(button=>button.addEventListener('click',()=>{chartMode=button.dataset.mode;document.querySelectorAll('.mode-button').forEach(item=>item.classList.toggle('is-active',item===button));if(windowResult)displayStrategies=chartMode==='restart'?windowResult.restartAtWindowStart.strategies:windowResult.continuousPath.strategies;drawAll()}));
    const observer=new ResizeObserver(()=>drawAll());observer.observe(document.querySelector('.charts'));drawAll();
    if(dates.length>=minimumWindowDays){updateWindowLabels();loadWindow()}else{statusNode.classList.add('error');statusNode.textContent='共同交易日不足，无法进行滑动窗口计算。'}
  </script>
</body>
</html>`
}
