import { prisma } from '../../db/prisma.js'

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function number(value: unknown, digits = 4) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—'
}

function dateTime(value: unknown) {
  if (!value) return '未记录'
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function list(items: unknown[], empty: string) {
  return items.length
    ? `<ul>${items.map((item: any) => `<li>${esc(item.message || item.reason || item)}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(empty)}</p>`
}

function linePath(values: Array<number | null>, width: number, height: number, min: number, max: number) {
  const range = max - min || 1
  const points = values.map((value, index) => value === null || !Number.isFinite(value) ? null : {
    x: values.length <= 1 ? width / 2 : index * width / (values.length - 1),
    y: height - ((value - min) / range) * height,
  })
  let started = false
  return points.map((point) => {
    if (!point) { started = false; return '' }
    const command = started ? 'L' : 'M'
    started = true
    return `${command}${point.x.toFixed(1)},${point.y.toFixed(1)}`
  }).join(' ')
}

function trendChart(asset: any) {
  const rows = Array.isArray(asset?.trend?.chart) ? asset.trend.chart.slice(-30) : []
  if (!rows.length) return '<p class="muted">最近30日数据不足。</p>'
  const series = [
    { key: 'close', color: '#0f172a', label: '收盘' },
    { key: 'ma5', color: '#2563eb', label: 'MA5' },
    { key: 'ma10', color: '#d97706', label: 'MA10' },
    { key: 'ma30', color: '#7c3aed', label: 'MA30' },
  ]
  const all = series.flatMap((item) => rows.map((row: any) => Number(row[item.key])).filter(Number.isFinite))
  const min = Math.min(...all)
  const max = Math.max(...all)
  const width = 860
  const height = 230
  const paths = series.map((item) => `<path d="${linePath(rows.map((row: any) => Number.isFinite(Number(row[item.key])) ? Number(row[item.key]) : null), width, height, min, max)}" fill="none" stroke="${item.color}" stroke-width="${item.key === 'close' ? 2.8 : 1.8}"/>`).join('')
  const latest = rows.at(-1)
  return `<div class="chart"><div class="legend">${series.map((item) => `<span><i style="background:${item.color}"></i>${item.label}</span>`).join('')}</div><svg viewBox="0 0 ${width} ${height + 32}" role="img" aria-label="${esc(asset.symbol)}最近30日收盘与均线">${[0, .25, .5, .75, 1].map((ratio) => `<line x1="0" x2="${width}" y1="${height * ratio}" y2="${height * ratio}" stroke="#e2e8f0"/>`).join('')}${paths}<text x="0" y="${height + 24}" fill="#64748b" font-size="12">${esc(rows[0]?.date)}</text><text x="${width}" y="${height + 24}" text-anchor="end" fill="#64748b" font-size="12">${esc(latest?.date)}</text></svg></div>`
}

function rrgChart(group: any) {
  const items = (group?.items || []).filter((item: any) => item?.points?.length)
  if (!items.length) return '<p class="muted">该分组没有达到日频RRG样本门槛的数据。</p>'
  const latest = items.map((item: any) => ({ item, point: item.points.at(-1) }))
  const values: number[] = latest.flatMap(({ point }: any) => [Number(point.relativeTrend), Number(point.relativeMomentum)]).filter((value: number) => Number.isFinite(value))
  const spread = Math.max(1, ...values.map((value) => Math.abs(value - 100))) * 1.2
  const min = 100 - spread
  const max = 100 + spread
  const size = 420
  const scale = (value: number) => ((value - min) / (max - min)) * size
  return `<svg class="rrg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(group.label)}日频相对轮动"><rect width="210" height="210" x="210" y="0" fill="#ecfdf3"/><rect width="210" height="210" x="0" y="0" fill="#eff6ff"/><rect width="210" height="210" x="0" y="210" fill="#fff7ed"/><rect width="210" height="210" x="210" y="210" fill="#fff1f2"/><line x1="210" x2="210" y1="0" y2="420" stroke="#94a3b8"/><line x1="0" x2="420" y1="210" y2="210" stroke="#94a3b8"/>${latest.map(({ item, point }: any, index: number) => {
    const x = scale(Number(point.relativeTrend))
    const y = size - scale(Number(point.relativeMomentum))
    const color = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2'][index % 6]
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}"/><text x="${Math.min(size - 8, x + 9).toFixed(1)}" y="${Math.max(13, y - 8).toFixed(1)}" font-size="12" fill="#172033">${esc(item.symbol)}</text>`
  }).join('')}<text x="8" y="18" class="quad">Improving</text><text x="412" y="18" text-anchor="end" class="quad">Leading</text><text x="8" y="410" class="quad">Lagging</text><text x="412" y="410" text-anchor="end" class="quad">Weakening</text></svg>`
}

function orderRows(rows: any[], label: string) {
  return rows.map((row: any) => {
    const pause = row.pauseRule || row.triggerCondition?.pauseRule || null
    return `<tr><td>${esc(label)}</td><td>${esc(row.symbol)}</td><td>${esc(row.side)}</td><td>${esc(row.orderRole || row.purpose || '—')}</td><td>${esc(row.activationStatus || row.status || '—')}</td><td>${esc(row.parentOrderRef || row.parentProposalId || '—')}</td><td>${esc(row.price || '—')}</td><td>${esc(row.quantity || '—')}</td><td>${pause ? `收盘${esc(pause.operator)} ${esc(pause.threshold)} 暂停` : '—'}</td><td>${esc(row.message || row.blocker || row.rationale || '')}</td></tr>`
  }).join('')
}

class DailyReviewHtmlService {
  async render(reviewId: string, userId: string) {
    const review = await prisma.dailyReviewRun.findFirst({ where: { id: reviewId, userId } })
    if (!review) throw new Error('Daily review not found')
    const report = parseJson<any>(review.reportJson, {})
    const reconciliation = report.reconciliation || null
    const facts = reconciliation?.confirmedFacts || { positions: [], userRules: [], openGridPairs: [] }
    const proposed = reconciliation?.proposedOrders || { retained: [], cancelCandidates: [], addCandidates: [], blocked: [] }
    const assets = Array.isArray(report.assets) ? report.assets : []
    const gridOrders = assets.flatMap((asset: any) => (asset.grid?.orders || []).map((order: any) => ({ ...order, symbol: asset.symbol, name: asset.name })))
    const allocationRules = (facts.userRules || []).filter((rule: any) => rule.rule === 'core_satellite_capacity')
    const downtrendRules = new Map((facts.userRules || [])
      .filter((rule: any) => rule.rule === 'downtrend_defensive_grid')
      .map((rule: any) => [rule.symbol, rule.value]))
    const allocationRows = allocationRules.map((rule: any) => {
      const grid: any = downtrendRules.get(rule.symbol) || {}
      const target = rule.value || {}
      const current = rule.currentDerived || {}
      return `<tr><td>${esc(rule.symbol)}</td><td>${esc(target.core)}</td><td>${esc(target.satellite)}</td><td>${esc(target.reboundExit || 0)}</td><td>${esc(current.core)}</td><td>${esc(current.satellite)}</td><td>${esc(current.reboundExit || 0)}</td><td>${esc(current.remainingSatelliteCapacity || 0)}</td><td>${grid.riskPolicy?.pauseRule ? `日收盘低于 ${esc(grid.riskPolicy.pauseRule.threshold)}：暂停待成交净买入` : '不参与波动交易'}</td></tr>`
    }).join('')
    const allOrderRows = [
      orderRows(proposed.retained || [], '拟保留'),
      orderRows(proposed.cancelCandidates || [], '拟撤销'),
      orderRows(proposed.addCandidates || [], '拟新增/查重'),
      orderRows(proposed.blocked || [], '阻断'),
      orderRows(gridOrders, '当日策略草案'),
    ].join('') || '<tr><td colspan="10">本轮没有订单草案。</td></tr>'
    const evidenceRefs = [...new Set(assets.flatMap((asset: any) => asset.fundamentalAndNews?.evidenceRefs || []))] as string[]
    const sourceLinks = evidenceRefs.map((ref) => /^https?:\/\//.test(ref)
      ? `<li><a href="${esc(ref)}" target="_blank" rel="noreferrer">${esc(ref)}</a></li>`
      : `<li>${esc(ref)}</li>`).join('')
    const session = report.sessionType === 'open' ? '开盘后' : report.sessionType === 'pre_close' ? '收盘前' : '手动'
    const filename = `daily-review-${String(report.generatedAt || review.generatedAt.toISOString()).slice(0, 16).replace(/[:T]/g, '-')}-${report.sessionType || 'manual'}.html`
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none';"><title>${esc(session)}持仓复盘 · FAMS</title>
<style>:root{--ink:#172033;--muted:#667085;--line:#dce4ee;--blue:#174ea6;--bg:#f4f7fb;--ok:#067647;--warn:#b54708;--danger:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 Inter,"PingFang SC","Microsoft YaHei",sans-serif}.shell{max-width:1240px;margin:auto;padding:24px}.hero,.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:18px;box-shadow:0 4px 14px rgba(15,23,42,.04)}.hero{background:linear-gradient(135deg,#102a56,#174ea6);color:#fff}.hero p{color:#dbeafe}h1,h2,h3{margin:0 0 8px}h1{font-size:32px}h2{font-size:22px}h3{font-size:17px}.meta,.muted{color:var(--muted)}.hero .meta{color:#bfdbfe}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.five{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.mini{border:1px solid var(--line);border-radius:12px;padding:13px;min-width:0}.pill{display:inline-block;border-radius:999px;padding:3px 9px;background:#eef2ff;color:var(--blue);font-weight:700;font-size:12px}.pill.warn{background:#fff7ed;color:var(--warn)}.pill.danger{background:#fff1f2;color:var(--danger)}table{width:100%;border-collapse:collapse;min-width:780px}th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}th{background:#f8fafc;color:var(--muted);font-size:12px}.scroll{overflow:auto}.chart svg{width:100%;height:auto}.legend{display:flex;gap:12px;flex-wrap:wrap}.legend i{display:inline-block;width:15px;height:3px;margin:0 5px 3px 0}.rrg{width:100%;max-width:520px}.quad{font-size:12px;fill:#64748b}ul{padding-left:20px}.asset{break-inside:avoid}.permission{border-left:5px solid var(--danger)}a{color:var(--blue)}@media(max-width:900px){.five{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}}@media(max-width:560px){.shell{padding:10px}.five{grid-template-columns:1fr}.hero,.card{padding:16px}}@media print{body{background:#fff}.shell{max-width:none;padding:0}.hero,.card{box-shadow:none}}</style></head>
<body><main class="shell"><header class="hero"><span class="pill">FAMS · ${esc(session)}复盘</span><h1>${esc(report.strategy?.assessment?.conclusion || '持仓复盘')}</h1><p>生成于 ${esc(dateTime(report.generatedAt))}。当前价与完整交易日收盘价分开；所有订单仅为人工复核草案，不会发送到券商。</p><div class="meta">复盘ID ${esc(review.id)} · 数据契约 ${esc(report.schemaVersion || 'legacy')}</div></header>
<section class="card"><h2>先对账，再分析</h2><div class="five"><div class="mini"><h3>已确认事实</h3><p>${facts.positions?.length || 0} 个券商持仓；可用资金 ${esc(facts.account?.availableCash || '未确认')}。</p><p>${facts.openGridPairs?.length || 0} 个待闭合波动批次。</p></div><div class="mini"><h3>对账差异</h3><p>${reconciliation?.reconciliationDifferences?.length || 0} 项；${reconciliation?.readiness?.requiredInputsReady ? '强制材料已就绪' : '持仓/成交材料未就绪'}。</p></div><div class="mini"><h3>待确认规则</h3><p>${reconciliation?.pendingRules?.length || 0} 项，不会自动升级为策略。</p></div><div class="mini"><h3>订单差异</h3><p>保留 ${proposed.retained?.length || 0} · 撤销 ${proposed.cancelCandidates?.length || 0} · 新增/查重 ${proposed.addCandidates?.length || 0} · 阻断 ${proposed.blocked?.length || 0}</p></div><div class="mini"><h3>执行权限</h3><p>只读、提醒和拟单；正式及自动交易均未解锁。</p></div></div></section>
<section class="card"><h2>已确认事实</h2><div class="scroll"><table><thead><tr><th>代码</th><th>名称</th><th>持仓</th><th>可卖</th><th>T+1暂不可卖</th><th>冻结</th><th>成本</th><th>截图价</th><th>来源</th></tr></thead><tbody>${(facts.positions || []).map((item: any) => `<tr><td>${esc(item.symbol)}</td><td>${esc(item.name)}</td><td>${esc(item.quantity)}</td><td>${esc(item.sellableQuantity)}</td><td>${esc(item.unavailableQuantity || '0')}</td><td>${esc(item.frozenQuantity)}</td><td>${esc(item.avgCost)}</td><td>${esc(item.screenshotPrice)}</td><td>${esc(item.sourceRef)}</td></tr>`).join('') || '<tr><td colspan="9">未找到已确认持仓事实。</td></tr>'}</tbody></table></div></section>
<section class="card"><h2>对账差异</h2>${list(reconciliation?.reconciliationDifferences || [], '没有记录到对账差异。')}</section>
<section class="card"><h2>待确认规则</h2>${list(reconciliation?.pendingRules || [], '没有待确认规则。')}</section>
<section class="card"><h2>仓位目标、已部署与暂停线</h2><p class="muted">核心仓不参与网格；“剩余”是容量，不代表应立即买满。赛力斯反弹减仓成交后永久退出。</p><div class="scroll"><table><thead><tr><th>代码</th><th>核心目标</th><th>卫星目标</th><th>反弹退出目标</th><th>核心已部署</th><th>卫星已部署</th><th>反弹退出已部署</th><th>卫星剩余容量</th><th>暂停规则</th></tr></thead><tbody>${allocationRows || '<tr><td colspan="9">没有已确认的仓位分层规则。</td></tr>'}</tbody></table></div></section>
<section class="card"><h2>拟保留／撤销／新增订单</h2><p class="muted">委托截图不完整时，“新增”只能是需人工查重的候选；等待父单成交、等待可卖和休眠档位不得提前挂入。</p><div class="scroll"><table><thead><tr><th>分类</th><th>代码</th><th>方向</th><th>角色</th><th>激活状态</th><th>父单</th><th>价格</th><th>数量</th><th>暂停线</th><th>理由/阻断</th></tr></thead><tbody>${allOrderRows}</tbody></table></div></section>
<section class="card permission"><h2>执行权限</h2><p>模式：${esc(reconciliation?.executionPermission?.mode || 'monitor_and_draft_only')}。formalTradingUnlocked=false，autoTradeUnlocked=false，canCreateOrder=false，orderCreateAllowed=false。用户必须在同花顺核对并手工执行。</p></section>
<section class="card"><h2>最新价、最近30个完整交易日与MA</h2><div class="scroll"><table><thead><tr><th>代码</th><th>最新价/时点</th><th>最后收盘</th><th>MA5</th><th>MA10</th><th>MA30</th><th>复权/质量</th></tr></thead><tbody>${assets.map((asset: any) => `<tr><td>${esc(asset.symbol)} ${esc(asset.name)}</td><td>${number(asset.trend?.quote?.price)}<br><small>${esc(dateTime(asset.trend?.quote?.asOf))} · ${esc(asset.trend?.quote?.freshnessStatus || 'unknown')}</small></td><td>${number(asset.trend?.latestClose?.price)}<br><small>${esc(asset.trend?.latestClose?.date)}</small></td><td>${number(asset.trend?.indicators?.ma5)}</td><td>${number(asset.trend?.indicators?.ma10)}</td><td>${number(asset.trend?.indicators?.ma30)}</td><td>${esc(asset.trend?.dataQuality?.historyAdjustment || '未记录')} / ${esc(asset.trend?.dataQuality?.status || 'unknown')}</td></tr>`).join('')}</tbody></table></div>${assets.map((asset: any) => `<article class="asset"><h3>${esc(asset.symbol)} · ${esc(asset.name)}</h3>${trendChart(asset)}</article>`).join('')}</section>
<section class="card"><h2>日频分组RRG</h2><p class="muted">仅使用完整交易日数据；透明相对轮动代理，不是官方JdK RRG，也不单独构成买卖信号。</p><div class="grid">${(report.relativeRotation?.groups || []).filter((group: any) => group.key !== 'cash').map((group: any) => `<article class="mini"><h3>${esc(group.label)}</h3><p class="muted">基准 ${esc(group.benchmark?.symbol || '—')} ${esc(group.benchmark?.name || '')}</p>${rrgChart(group)}</article>`).join('') || '<p class="muted">RRG数据不可用。</p>'}</div></section>
<section class="card"><h2>消息面、基本面与关注标的</h2><div class="grid">${assets.map((asset: any) => `<article class="mini"><h3>${esc(asset.symbol)} · ${esc(asset.name)}</h3><span class="pill ${asset.fundamentalAndNews?.level === 'material' ? 'danger' : asset.fundamentalAndNews?.level === 'insufficient' ? 'warn' : ''}">${esc(asset.fundamentalAndNews?.level || 'insufficient')}</span>${list(asset.fundamentalAndNews?.reasons || [], '未记录变化理由。')}</article>`).join('')}</div><h3>证据索引</h3><ul>${sourceLinks || '<li>没有可展示的证据引用。</li>'}</ul></section>
<footer class="meta">本报告为本地研究与人工计划草案，不构成投资建议。历史成交若已包含在最新持仓快照中，不得重复扣加。</footer></main></body></html>`
    return { filename, html }
  }
}

export const dailyReviewHtmlService = new DailyReviewHtmlService()
