import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

type JsonObject = Record<string, any>

const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.replace(/^--/, '').split('=')
  return [key, value.join('=')]
}))

const reviewId = args.reviewId
if (!reviewId) throw new Error('Usage: --reviewId=<id> [--evidence=<json>] [--output=<html>] [--audit=<json>]')

const repoRoot = resolve(process.cwd(), '..')
const evidencePath = resolve(repoRoot, args.evidence || '.verification/private/daily-review/official-evidence.json')
const outputPath = resolve(repoRoot, args.output || '.verification/private/daily-review/open-review.html')
const auditPath = resolve(repoRoot, args.audit || '.verification/private/daily-review/open-review.audit.json')

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const round = (value: number, digits = 4) => Number(value.toFixed(digits))
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const almostEqual = (left: number, right: number, tolerance = 0.000001) => Math.abs(left - right) <= tolerance
const money = (value: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(value)
const number = (value: number, digits = 2) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
const price = (value: number) => value < 10 ? number(value, 4) : number(value, 2)
const percent = (value: number) => `${value >= 0 ? '+' : ''}${number(value, 2)}%`
const chinaTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date(value))

const label = (code: string) => ({
  material_change_requires_review: '重大变化：禁止买入，人工复核',
  buy_budget_or_weight_capacity_exhausted: '已超过20%单标的上限',
  fundamental_or_news_evidence_insufficient: '基本面/消息证据降级',
  stock_valuation_evidence_insufficient: '个股估值证据不足',
  sell_quantity_below_minimum_lot: '可卖数量小于1手',
  order_size_below_minimum_lot_or_available_budget: '分档数量小于最小交易单位',
}[code] || code)

function sparkline(points: any[], currentPrice: number, symbol: string) {
  const width = 760
  const height = 244
  const left = 44
  const right = 18
  const top = 20
  const bottom = 34
  const values = points.flatMap((point) => [point.close, point.ma5, point.ma10, point.ma30]).filter((value) => typeof value === 'number')
  values.push(currentPrice)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max((max - min) * 0.12, max * 0.005)
  const low = min - pad
  const high = max + pad
  const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right)
  const y = (value: number) => top + (high - value) / Math.max(0.000001, high - low) * (height - top - bottom)
  const polyline = (key: string) => points.filter((point) => typeof point[key] === 'number').map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ')
  const currentY = y(currentPrice).toFixed(1)
  const last = points.at(-1)
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(symbol)} 最近30个交易日收盘价与均线图">
    <line x1="${left}" x2="${width - right}" y1="${top}" y2="${top}" class="gridline" />
    <line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" class="gridline" />
    <line x1="${left}" x2="${width - right}" y1="${currentY}" y2="${currentY}" class="current-line" />
    <polyline points="${polyline('close')}" class="line close-line" />
    <polyline points="${polyline('ma5')}" class="line ma5-line" />
    <polyline points="${polyline('ma10')}" class="line ma10-line" />
    <polyline points="${polyline('ma30')}" class="line ma30-line" />
    <circle cx="${x(points.length - 1)}" cy="${y(last.close)}" r="4" class="close-dot" />
    <text x="4" y="${top + 4}" class="axis-label">${escapeHtml(price(high))}</text>
    <text x="4" y="${height - bottom + 4}" class="axis-label">${escapeHtml(price(low))}</text>
    <text x="${left}" y="${height - 9}" class="axis-label">${escapeHtml(points[0].date.slice(5))}</text>
    <text x="${width - 54}" y="${height - 9}" class="axis-label">${escapeHtml(last.date.slice(5))}</text>
    <text x="${width - 128}" y="${Number(currentY) - 6}" class="current-label">本轮 ${escapeHtml(price(currentPrice))}</text>
  </svg>`
}

function sourceLinks(sources: any[]) {
  return sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.publishedAt)}</span></li>`).join('')
}

const review = await prisma.dailyReviewRun.findUnique({ where: { id: reviewId } })
if (!review) throw new Error(`Daily review not found: ${reviewId}`)
const report = parseJson<JsonObject>(review.reportJson, {})
const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as JsonObject
const dbOrders = await prisma.gridOrderDraft.findMany({
  where: { gridPlan: { dailyReviewRunId: reviewId } },
  include: { gridPlan: { select: { assetId: true } } },
  orderBy: [{ side: 'asc' }, { level: 'asc' }],
})
const integrity = await prisma.$queryRawUnsafe<Array<Record<string, string>>>('PRAGMA integrity_check')
const protectedCounts = {
  positions: await prisma.position.count({ where: { userId: review.userId } }),
  transactions: await prisma.transaction.count({ where: { userId: review.userId } }),
  externalOrderObservations: await prisma.externalOrderObservation.count({ where: { userId: review.userId } }),
}

const checks: Array<{ id: string; status: 'pass' | 'fail'; detail: string }> = []
const check = (id: string, condition: boolean, detail: string) => checks.push({ id, status: condition ? 'pass' : 'fail', detail })
const assets = report.assets || []
check('review_completed', review.status === 'completed', `status=${review.status}`)
check('all_holdings_reviewed', assets.length === 6 && report.errors?.length === 0, `assets=${assets.length}, errors=${report.errors?.length || 0}`)
check('live_portfolio_pricing', report.portfolio?.pricing?.basis === 'review_quote_price' && report.portfolio?.pricing?.fallbackPricedAssets?.length === 0, JSON.stringify(report.portfolio?.pricing || {}))
const recomputedTotal = Number(report.portfolio?.cashBudget || 0) + assets.reduce((sum: number, asset: any) => sum + Number(asset.position?.marketValue || 0), 0)
check('portfolio_reconciled', almostEqual(recomputedTotal, Number(report.portfolio?.totalValue || 0), 0.01), `${round(recomputedTotal, 2)} == ${round(report.portfolio?.totalValue || 0, 2)}`)
for (const asset of assets) {
  const closes = asset.trend?.recentCloses || []
  const dates = closes.map((item: any) => item.date)
  const uniqueAscending = new Set(dates).size === 30 && dates.every((date: string, index: number) => index === 0 || dates[index - 1] < date)
  check(`${asset.symbol}_30_closes`, closes.length === 30 && uniqueAscending, `bars=${closes.length}, ${dates[0]}..${dates.at(-1)}`)
  const values = closes.map((item: any) => Number(item.close))
  const ma5 = round(mean(values.slice(-5)))
  const ma10 = round(mean(values.slice(-10)))
  const ma30 = round(mean(values.slice(-30)))
  check(`${asset.symbol}_ma`, almostEqual(ma5, asset.trend.indicators.ma5) && almostEqual(ma10, asset.trend.indicators.ma10) && almostEqual(ma30, asset.trend.indicators.ma30), `MA=${ma5}/${ma10}/${ma30}`)
  check(`${asset.symbol}_quote`, asset.trend?.quote?.source === 'sina' && asset.trend?.quote?.fallbackUsed === false, `source=${asset.trend?.quote?.source}, fallback=${asset.trend?.quote?.fallbackUsed}`)
  check(`${asset.symbol}_official_evidence`, Boolean(evidence.assets?.[asset.symbol]), `status=${evidence.assets?.[asset.symbol]?.status || 'missing'}`)
}
const runtimeEvidenceContradictions = assets.filter((asset: any) => (
  asset.evidenceMode === 'current_factset'
  && String(evidence.assets?.[asset.symbol]?.summary || '').includes('适配器超时降级')
))
check('evidence_runtime_consistency', runtimeEvidenceContradictions.length === 0, `contradictions=${runtimeEvidenceContradictions.map((asset: any) => asset.symbol).join(',') || 'none'}`)
const reportOrderIds = new Set(assets.flatMap((asset: any) => asset.grid?.orders || []).map((order: any) => order.id))
check('grid_orders_reconciled', dbOrders.length === reportOrderIds.size && dbOrders.every((order) => reportOrderIds.has(order.id)), `db=${dbOrders.length}, report=${reportOrderIds.size}`)
check('execution_locked', report.executionBoundary?.formalTradingUnlocked === false && report.executionBoundary?.autoTradeUnlocked === false && report.executionBoundary?.canCreateOrder === false && report.executionBoundary?.orderCreateAllowed === false, JSON.stringify(report.executionBoundary || {}))
check('database_integrity', integrity.length === 1 && Object.values(integrity[0] || {})[0] === 'ok', JSON.stringify(integrity))
if (checks.some((item) => item.status === 'fail')) throw new Error(`Truth gate failed: ${JSON.stringify(checks.filter((item) => item.status === 'fail'))}`)

const symbolOrder = ['601127', '000651', '600276', '601318', '513770', '159851']
assets.sort((left: any, right: any) => symbolOrder.indexOf(left.symbol) - symbolOrder.indexOf(right.symbol))
const actionable = assets.filter((asset: any) => (asset.grid?.orders || []).length > 0)
const observeOnly = assets.filter((asset: any) => (asset.grid?.orders || []).length === 0)
const allOrders = assets.flatMap((asset: any) => (asset.grid?.orders || []).map((order: any) => ({ ...order, symbol: asset.symbol, name: asset.name })))
const orderClipboardData = allOrders.map((order: any) => ({
  symbol: order.symbol,
  side: order.side,
  level: order.level,
  price: order.price,
  quantity: order.quantity,
  validUntil: order.validUntil,
}))
const generatedAt = chinaTime(report.generatedAt)
const quoteAsOf = chinaTime(assets.map((asset: any) => asset.trend.quote.asOf).sort().at(-1))
const highPriority = evidence.assets['601127']
const activeStrategyVersionIds = parseJson<string[]>(review.strategyVersionIdsJson, [])
const strategyProvenance = activeStrategyVersionIds.length > 0
  ? `已绑定 ${activeStrategyVersionIds.length} 个激活策略版本`
  : '未绑定激活策略版本；本轮网格来自系统研究回退，必须人工确认'
const materialAssets = assets.filter((asset: any) => asset.fundamentalAndNews?.level === 'material')
const degradedAssets = assets.filter((asset: any) => asset.evidenceMode !== 'current_factset')
const materialSymbols = materialAssets.map((asset: any) => asset.symbol).join('、') || '无'
const evidenceRuntimeSummary = degradedAssets.length > 0
  ? `${degradedAssets.map((asset: any) => asset.symbol).join('、')} 的项目事实适配器降级，已保持观察`
  : '六个持仓的项目事实集均在本轮可用'
const materialOfficialSummary = materialAssets
  .map((asset: any) => evidence.assets?.[asset.symbol]?.summary)
  .filter(Boolean)
  .join(' ')

const audit = {
  schemaVersion: 'fams.daily-review-truth-audit.v1',
  generatedAt: new Date().toISOString(),
  reviewId,
  reviewStatus: review.status,
  checks,
  protectedCounts,
  outputPath,
  evidencePath,
  conclusion: 'pass',
}

const tableRows = assets.map((asset: any) => {
  const trendClass = asset.trend.indicators.trend === 'bullish' ? 'positive' : asset.trend.indicators.trend === 'bearish' ? 'negative' : 'warning'
  const evidenceClass = asset.evidenceMode === 'current_factset' ? 'positive' : 'warning'
  return `<tr data-symbol="${escapeHtml(asset.symbol)}">
    <td><strong>${escapeHtml(asset.symbol)}</strong><small>${escapeHtml(asset.name)}</small></td>
    <td>${price(asset.trend.quote.price)}<small class="${asset.trend.quote.changePercent >= 0 ? 'up' : 'down'}">${percent(asset.trend.quote.changePercent)}</small></td>
    <td>${price(asset.trend.indicators.ma5)}</td><td>${price(asset.trend.indicators.ma10)}</td><td>${price(asset.trend.indicators.ma30)}</td>
    <td><span class="pill ${trendClass}">${escapeHtml(asset.trend.indicators.trend)}</span></td>
    <td>${number(asset.position.weightPct, 2)}%</td>
    <td><span class="pill ${evidenceClass}">${asset.evidenceMode === 'current_factset' ? '本轮事实' : '超时降级'}</span></td>
    <td>${asset.grid.orders.length ? `<strong>${asset.grid.orders.length} 笔草案</strong>` : `<span class="muted">观察</span>`}</td>
  </tr>`
}).join('')

const orderRows = allOrders.map((order: any) => `<tr>
  <td><strong>${escapeHtml(order.symbol)}</strong><small>${escapeHtml(order.name)}</small></td>
  <td><span class="pill ${order.side === 'buy' ? 'positive' : 'negative'}">${order.side === 'buy' ? '买入' : '卖出'} ${order.level}</span></td>
  <td>${price(order.price)}</td><td>${number(order.quantity, 0)}</td><td>${money(order.amount)}</td><td>${chinaTime(order.validUntil)}</td>
</tr>`).join('')

const derivationCards = actionable.map((asset: any) => {
  const d = asset.grid.derivation
  const buyCount = asset.grid.orders.filter((order: any) => order.side === 'buy').length
  const sellCount = asset.grid.orders.filter((order: any) => order.side === 'sell').length
  return `<article class="logic-card">
    <header><div><span class="eyebrow">${escapeHtml(asset.symbol)}</span><h3>${escapeHtml(asset.name)}</h3></div><span class="pill ${asset.symbol === '601127' ? 'negative' : 'positive'}">买${buyCount} / 卖${sellCount}</span></header>
    <ol class="logic-flow">
      <li><b>输入</b><span>现价 ${price(asset.trend.quote.price)}；MA10 ${price(d.anchor.value)}；仓位 ${number(asset.position.weightPct, 2)}%</span></li>
      <li><b>锚点</b><span>${escapeHtml(d.anchor.source)} = ${price(d.anchor.value)}</span></li>
      <li><b>间距</b><span>ATR14 ${price(d.spacing.atr14)} × ${d.spacing.policyValue} → ${number(d.spacing.finalPercent, 2)}%</span></li>
      <li><b>数量</b><span>现金底线 ${d.sizing.cashFloorPercent}%；单标的上限 ${d.sizing.maxAssetWeightPercent}%；最大调整 ${d.sizing.maxAdjustmentPercent}%</span></li>
      <li><b>结论</b><span>${escapeHtml(asset.grid.summary)}</span></li>
    </ol>
    ${asset.grid.blockers.length ? `<div class="callout danger">${asset.grid.blockers.map((item: string) => escapeHtml(label(item))).join('；')}</div>` : ''}
  </article>`
}).join('')

const chartPanels = assets.map((asset: any, index: number) => `<section class="chart-panel" data-chart="${escapeHtml(asset.symbol)}" ${index ? 'hidden' : ''}>
  <div class="chart-head"><div><h3>${escapeHtml(asset.symbol)} · ${escapeHtml(asset.name)}</h3><p>收盘线截至 ${escapeHtml(asset.trend.indicators.asOf)}；本轮价 ${price(asset.trend.quote.price)} @ ${chinaTime(asset.trend.quote.asOf)}</p></div><div class="legend"><span class="close">收盘</span><span class="ma5">MA5</span><span class="ma10">MA10</span><span class="ma30">MA30</span></div></div>
  ${sparkline(asset.trend.chart, asset.trend.quote.price, asset.symbol)}
  <details><summary>查看最近30个收盘价</summary><div class="close-grid">${asset.trend.recentCloses.map((item: any) => `<span><b>${escapeHtml(item.date.slice(5))}</b>${price(item.close)}</span>`).join('')}</div></details>
</section>`).join('')

const attentionCards = symbolOrder.map((symbol) => {
  const asset = assets.find((item: any) => item.symbol === symbol)
  const item = evidence.assets[symbol]
  const tone = item.status === 'material_negative' ? 'danger' : item.status === 'corporate_action_watch' ? 'warning' : 'neutral'
  return `<article class="attention ${tone}"><header><div><span class="eyebrow">${escapeHtml(symbol)}</span><h3>${escapeHtml(asset.name)}</h3></div><span class="pill ${item.confidence === 'high' ? 'positive' : item.confidence === 'medium' ? 'warning' : ''}">置信度 ${escapeHtml(item.confidence)}</span></header><p>${escapeHtml(item.summary)}</p><details><summary>核验来源 ${item.sources.length} 条</summary><ul class="sources">${sourceLinks(item.sources)}</ul></details></article>`
}).join('')

const observeRows = observeOnly.map((asset: any) => `<tr><td><strong>${escapeHtml(asset.symbol)}</strong><small>${escapeHtml(asset.name)}</small></td><td>${price(asset.trend.quote.price)}</td><td>${price(asset.grid.derivation.anchor.value)}</td><td>${asset.grid.blockers.map((item: string) => escapeHtml(label(item))).join('；') || '无'}</td><td>${asset.grid.adjustment.changed ? '调整' : '保持观察'}</td></tr>`).join('')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>2026-08-24 开盘后持仓复盘 · FAMS</title>
<style>
:root{color-scheme:light;--navy:#0b1f3a;--navy-2:#16345e;--slate:#475569;--muted:#64748b;--line:#dce4ee;--surface:#fff;--canvas:#f4f7fb;--red:#b42318;--red-bg:#fff1f0;--green:#087a55;--green-bg:#ecfdf5;--amber:#9a6700;--amber-bg:#fff8e1;--blue:#2563eb;--shadow:0 10px 28px rgba(15,23,42,.08);--r:18px}
*{box-sizing:border-box}html{scroll-behavior:smooth;max-width:100%;overflow-x:hidden}body{max-width:100%;overflow-x:hidden;margin:0;background:var(--canvas);color:#172033;font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.6}a{color:#174ea6;text-decoration:none}a:hover{text-decoration:underline}button{font:inherit}.shell{width:100%;max-width:1240px;margin:auto;padding:28px 22px 64px}.hero{background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;border-radius:24px;padding:34px;box-shadow:var(--shadow)}.hero-top,.section-head,.chart-head,.logic-card header,.attention header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.hero-top>*,.section-head>*,.chart-head>*,.logic-card header>*,.attention header>*{min-width:0}.kicker,.eyebrow{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.kicker{color:#b8d2ff}.eyebrow{color:var(--muted)}h1,h2,h3,p{margin-top:0;overflow-wrap:anywhere}h1{font-size:clamp(30px,5vw,48px);line-height:1.15;margin-bottom:12px}h2{font-size:25px;margin-bottom:8px}h3{font-size:18px;margin-bottom:4px}.hero p{max-width:830px;color:#d7e4f7;margin-bottom:0}.hero-actions{display:flex;flex:0 0 auto;gap:8px;flex-wrap:wrap}.btn{border:1px solid rgba(255,255,255,.35);border-radius:10px;padding:9px 13px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;white-space:nowrap}.btn.primary{background:#fff;color:var(--navy);font-weight:750}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:24px}.metric{min-width:0;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px}.metric span{display:block;color:#c7d5e9;font-size:12px}.metric strong{display:block;font-size:21px;margin-top:3px;overflow-wrap:anywhere}.section{min-width:0;margin-top:24px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:24px;box-shadow:0 3px 12px rgba(15,23,42,.04)}.section-head{margin-bottom:18px}.section-head p,.chart-head p{color:var(--muted);margin-bottom:0}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;background:#eef2f7;color:#435168;font-size:12px;font-weight:750;white-space:nowrap}.pill.positive{background:var(--green-bg);color:var(--green)}.pill.negative{background:var(--red-bg);color:var(--red)}.pill.warning{background:var(--amber-bg);color:var(--amber)}.decision{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:16px}.decision-main{min-width:0;border-left:5px solid var(--red);padding:4px 0 4px 18px}.decision-main h2{font-size:28px}.decision-main p{color:var(--slate)}.decision-aside{min-width:0;background:var(--red-bg);border:1px solid #ffd2cc;border-radius:14px;padding:16px}.decision-aside strong{display:block;color:var(--red);font-size:18px}.decision-aside ul{padding-left:19px;margin-bottom:0}.dag{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:28px;margin-top:18px}.dag-node{min-width:0;position:relative;border:1px solid var(--line);background:#f8fafc;border-radius:12px;padding:12px;text-align:center;font-size:13px;font-weight:750;overflow-wrap:anywhere}.dag-node:not(:last-child)::after{content:"→";position:absolute;right:-22px;color:#94a3b8;font-size:18px}.table-wrap,.chart-tabs{max-width:100%}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;min-width:840px}th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--muted);background:#f8fafc}td{font-variant-numeric:tabular-nums}td small{display:block;color:var(--muted);font-size:12px}.up{color:var(--red)}.down{color:var(--green)}.muted{color:var(--muted)}.logic-grid,.attention-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.logic-card,.attention{min-width:0;border:1px solid var(--line);border-radius:14px;padding:17px;background:#fff}.logic-flow{list-style:none;margin:14px 0 0;padding:0}.logic-flow li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:10px;padding:9px 0;border-top:1px dashed var(--line)}.logic-flow b{color:var(--navy)}.logic-flow span{color:var(--slate);overflow-wrap:anywhere}.callout{margin-top:12px;border-radius:10px;padding:10px 12px;font-size:13px}.callout.danger{background:var(--red-bg);color:var(--red)}.attention.danger{border-left:4px solid var(--red)}.attention.warning{border-left:4px solid var(--amber)}.attention p{color:var(--slate);margin:12px 0}.sources{padding-left:18px}.sources li{margin:8px 0;overflow-wrap:anywhere}.sources span{display:block;color:var(--muted);font-size:12px}.chart-tabs{display:flex;gap:8px;overflow:auto;margin:16px 0}.chart-tab{border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--slate);padding:7px 12px;cursor:pointer;white-space:nowrap}.chart-tab[aria-selected="true"]{background:var(--navy);color:#fff;border-color:var(--navy)}.chart-panel{min-width:0}.chart-panel svg{width:100%;max-width:100%;height:auto;display:block}.line{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}.close-line{stroke:#101828;stroke-width:2.8}.ma5-line{stroke:#2563eb}.ma10-line{stroke:#d97706}.ma30-line{stroke:#7c3aed}.close-dot{fill:#101828}.gridline{stroke:#dce4ee;stroke-width:1}.current-line{stroke:#b42318;stroke-width:1.5;stroke-dasharray:6 5}.axis-label{font-size:11px;fill:#64748b}.current-label{font-size:11px;fill:#b42318;font-weight:700}.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px}.legend span::before{content:"";display:inline-block;width:14px;height:3px;margin:0 5px 3px 0;border-radius:9px;background:#101828}.legend .ma5::before{background:#2563eb}.legend .ma10::before{background:#d97706}.legend .ma30::before{background:#7c3aed}.close-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px;margin-top:12px}.close-grid span{min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center;font-variant-numeric:tabular-nums;font-size:12px}.close-grid b{display:block;color:var(--muted);font-weight:500}.audit-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.audit-item{min-width:0;border:1px solid #bdebd7;background:var(--green-bg);border-radius:11px;padding:10px;overflow-wrap:anywhere}.audit-item strong{color:var(--green);display:block}.fineprint{color:var(--muted);font-size:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}details summary{cursor:pointer;color:#344054;font-weight:700}.footer{text-align:center;color:var(--muted);font-size:12px;margin-top:22px}
@media(max-width:1100px){.hero-top{display:block}.hero-actions{margin-top:20px}.metrics,.audit-grid{grid-template-columns:repeat(2,1fr)}.decision{grid-template-columns:1fr}.logic-grid,.attention-grid{grid-template-columns:1fr 1fr}.dag{grid-template-columns:1fr;gap:8px}.dag-node:not(:last-child)::after{display:none}.close-grid{grid-template-columns:repeat(5,1fr)}}
@media(max-width:620px){.shell{padding:14px 10px 42px}.hero,.section{padding:18px}.hero-top,.section-head,.chart-head{display:block}.hero-actions{margin-top:14px}.metrics,.logic-grid,.attention-grid,.audit-grid{grid-template-columns:1fr}.decision-main h2{font-size:23px}.close-grid{grid-template-columns:repeat(3,1fr)}}
@media print{body{background:#fff}.shell{max-width:none;padding:0}.hero,.section{box-shadow:none;break-inside:avoid}.hero-actions,.chart-tabs button{display:none}.chart-panel[hidden]{display:block!important}.section{page-break-inside:auto}a{color:#172033;text-decoration:none}}
</style>
</head>
<body>
<main class="shell">
  <header class="hero">
    <div class="hero-top"><div><div class="kicker">FAMS · 开盘后真实数据复盘</div><h1>先降集中度，再做两只 ETF 的波动网格</h1><p>本轮覆盖全部 6 个持仓。${escapeHtml(materialSymbols)} 触发重大变化复核；${escapeHtml(evidenceRuntimeSummary)}。页面中的订单均为人工计划草案，不会发送给券商。</p></div><div class="hero-actions"><button class="btn primary" id="copy-orders">复制订单</button><button class="btn" onclick="window.print()">打印 / PDF</button><a class="btn" href="http://localhost:3000/daily-reviews/${escapeHtml(reviewId)}" target="_blank">打开完整 DAG</a></div></div>
    <div class="metrics"><div class="metric"><span>本轮组合总值</span><strong>${money(report.portfolio.totalValue)}</strong></div><div class="metric"><span>可用现金 / 现金占比</span><strong>${money(report.portfolio.cashBudget)} · ${number(report.portfolio.cashBudget / report.portfolio.totalValue * 100, 1)}%</strong></div><div class="metric"><span>本轮报价时点</span><strong>${escapeHtml(quoteAsOf)}</strong></div><div class="metric"><span>真实性闸门</span><strong>6 / 6 · ${checks.length} 项通过</strong></div></div>
  </header>

  <section class="section decision">
    <div class="decision-main"><div class="eyebrow">具体结论摘要</div><h2>调整原策略：停止对 601127 加仓，反弹分三档卖出 400 股</h2><p>${escapeHtml(materialOfficialSummary || highPriority.summary)}</p><div class="dag"><div class="dag-node">实时价 + 30日收盘</div><div class="dag-node">MA / ATR / 仓位</div><div class="dag-node">官方公告与事实集</div><div class="dag-node">风险/证据门禁</div><div class="dag-node">人工计划草案</div></div></div>
    <aside class="decision-aside"><strong>今天优先做什么</strong><ul><li>601127：仅挂反弹卖单，不挂买单。</li><li>513770、159851：使用下方三买三卖草案，单标的不得超过20%。</li><li>600276：事件风险触发重大变化复核，不新增订单。</li><li>000651：8月27日除息，今天网格禁止跨日沿用。</li><li>601318：仅1手，受最小交易单位约束，保持观察。</li></ul></aside>
  </section>

  <section class="section" id="orders"><div class="section-head"><div><div class="eyebrow">订单草案</div><h2>具体需要设置的买卖单</h2><p>共 ${allOrders.length} 笔；时间字段表示复盘草案的新鲜度，实际挂单只能在交易时段内人工完成。${escapeHtml(strategyProvenance)}。到期或收盘后必须重新复盘。</p></div><span class="pill warning">formal trading locked</span></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>方向 / 档位</th><th>限价</th><th>数量</th><th>金额</th><th>草案复核有效至（北京时间）</th></tr></thead><tbody>${orderRows}</tbody></table></div></section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">推导依据</div><h2>为什么是这些价格和数量</h2><p>展示可审查的输入、公式、约束与结论；不展示模型私有思维链。</p></div></div><div class="logic-grid">${derivationCards}</div></section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">全仓概览</div><h2>实时价、均线与仓位</h2><p>MA 使用截至 2026-08-21 的完整日线收盘价；本轮价来自项目新浪行情适配器且均未回退。</p></div></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>本轮价 / 涨跌</th><th>MA5</th><th>MA10</th><th>MA30</th><th>趋势</th><th>仓位</th><th>证据</th><th>动作</th></tr></thead><tbody>${tableRows}</tbody></table></div></section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">价格图</div><h2>最近30个交易日走势</h2><p>黑线为收盘，彩色线为MA5/MA10/MA30，红色虚线为本轮盘中价。</p></div></div><div class="chart-tabs" role="tablist">${assets.map((asset: any, index: number) => `<button class="chart-tab" role="tab" data-target="${escapeHtml(asset.symbol)}" aria-selected="${index === 0}">${escapeHtml(asset.symbol)} ${escapeHtml(asset.name)}</button>`).join('')}</div>${chartPanels}</section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">消息面与基本面</div><h2>需要关注的标的 · 已做可读摘要</h2><p>优先采用交易所/巨潮/基金管理人入口；“未发现”仅覆盖 ${escapeHtml(evidence.queryWindow.start)} 至 ${escapeHtml(evidence.queryWindow.end)} 的本轮查询范围。</p></div></div><div class="attention-grid">${attentionCards}</div></section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">观察清单</div><h2>本轮不设置订单的标的</h2><p>未通过证据或最小交易单位门禁，不代表看空，也不以缺失证据推导买卖。</p></div></div><div class="table-wrap"><table><thead><tr><th>标的</th><th>本轮价</th><th>网格锚</th><th>拦截原因</th><th>相较上一网格</th></tr></thead><tbody>${observeRows}</tbody></table></div></section>

  <section class="section"><div class="section-head"><div><div class="eyebrow">真实性校验</div><h2>数据与内容检查</h2><p>报告生成前自动执行；任何失败都会终止 HTML 生成。</p></div><span class="pill positive">PASS</span></div><div class="audit-grid">${checks.map((item) => `<div class="audit-item"><strong>✓ ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.detail)}</span></div>`).join('')}</div><p class="fineprint">项目 LLM 综合：${escapeHtml(report.llmSynthesis?.status || 'unknown')} / ${escapeHtml(report.llmSynthesis?.failureCode || 'no_failure')}。本页没有把失败的模型输出宣称为成功；结论使用可回溯事实、公式与保守门禁。数据库完整性：ok。持仓 ${protectedCounts.positions} 条、交易 ${protectedCounts.transactions} 条、外部订单观测 ${protectedCounts.externalOrderObservations} 条。执行边界：计划草案；正式交易、自动交易、创建订单均为 false。</p></section>

  <footer class="footer">复盘 ${escapeHtml(reviewId)} · 生成 ${escapeHtml(generatedAt)} · 仅供研究与人工计划，不构成投资建议</footer>
</main>
<script type="application/json" id="order-data">${JSON.stringify(orderClipboardData).replaceAll('<', '\\u003c')}</script>
<script>
const tabs=[...document.querySelectorAll('.chart-tab')];
tabs.forEach(tab=>tab.addEventListener('click',()=>{tabs.forEach(item=>item.setAttribute('aria-selected','false'));tab.setAttribute('aria-selected','true');document.querySelectorAll('.chart-panel').forEach(panel=>panel.hidden=panel.dataset.chart!==tab.dataset.target)}));
document.getElementById('copy-orders').addEventListener('click',async(event)=>{const button=event.currentTarget;const orders=JSON.parse(document.getElementById('order-data').textContent);const text=orders.map(o=>[o.symbol,o.side==='buy'?'买入':'卖出','第'+o.level+'档','限价 '+o.price,'数量 '+o.quantity,'草案复核有效至 '+new Date(o.validUntil).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})].join(' · ')).join('\\n');try{await navigator.clipboard.writeText(text);button.textContent='已复制'}catch{button.textContent='浏览器未授权复制'}});
</script>
</body>
</html>`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, html, 'utf8')
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, auditPath, reviewId, checks: checks.length, orders: allOrders.length }, null, 2))
await prisma.$disconnect()
