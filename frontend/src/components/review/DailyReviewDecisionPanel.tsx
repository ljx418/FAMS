import { Alert, Button, Card, Collapse, Descriptions, Empty, Statistic, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AuditOutlined, CopyOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

const formatNumber = (value: unknown, digits = 4) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—'
}

const formatMoney = (value: unknown) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }) : '—'
}

const formatDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value))
  : '未记录'

const actionMeta: Record<string, { label: string; color: string }> = {
  manual_two_sided_grid: { label: '双向人工计划', color: 'blue' },
  manual_buy_grid: { label: '买入人工计划', color: 'red' },
  manual_sell_grid: { label: '卖出人工计划', color: 'green' },
  needs_review: { label: '需要复核', color: 'warning' },
  observe: { label: '仅观察', color: 'default' },
}

const blockerLabel = (value: string) => ({
  material_change_requires_review: '重大变化：禁止新增买入',
  fundamental_or_news_evidence_insufficient: '基本面或消息证据不足',
  stock_valuation_evidence_insufficient: '个股估值证据不足',
  stock_valuation_risk_review: '估值结论要求风险复核',
  stock_valuation_overvalued_watch: '估值偏高：禁止新增买入',
  buy_budget_or_weight_capacity_exhausted: '买入预算或仓位空间不足',
  sell_quantity_below_minimum_lot: '卖出数量不足最小交易单位',
  order_size_below_minimum_lot_or_available_budget: '预算或数量不足以形成订单',
}[value] || value)

function DerivationContent({ asset }: { asset: any }) {
  const derivation = asset.gridDerivation || {}
  const anchor = derivation.anchor || {}
  const spacing = derivation.spacing || {}
  const sizing = derivation.sizing || {}
  const gates = derivation.gates || { global: [], buy: [], sell: [] }
  const valuation = asset.valuationContext || {}
  return (
    <div className="space-y-4" data-testid={`derivation-${asset.symbol}`}>
      <Alert type="info" showIcon message="这是确定性规则的可复算推导链，不是模型私密思维链。" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="small" title="一、价值评估基线">
          <Descriptions size="small" column={1} items={[
            { key: 'applicability', label: '适用口径', children: valuation.applicability === 'not_applicable' ? '非个股，不适用个股估值' : '个股相对估值' },
            { key: 'status', label: '状态', children: valuation.status || '未记录' },
            { key: 'band', label: '估值区间', children: valuation.valuationBand || 'unknown' },
            { key: 'score', label: '综合评分', children: formatNumber(valuation.compositeScore, 2) },
            { key: 'confidence', label: '置信度', children: valuation.confidence || 'insufficient' },
            { key: 'method', label: '方法', children: valuation.method || '未记录' },
          ]} />
          {(valuation.reasons || []).length ? <ul className="mb-0 mt-3 pl-5 text-sm leading-6 text-slate-600">{valuation.reasons.slice(0, 4).map((reason: string) => <li key={reason}>{reason}</li>)}</ul> : null}
        </Card>
        <Card size="small" title="二、技术价格锚">
          <Descriptions size="small" column={1} items={[
            { key: 'policy', label: '策略', children: anchor.policy || '未记录' },
            { key: 'source', label: '实际来源', children: anchor.source || '未记录' },
            { key: 'value', label: '网格锚点', children: formatNumber(anchor.value, 4) },
            { key: 'current', label: '当前价', children: formatNumber(anchor.inputs?.currentPrice, 4) },
            { key: 'ma10', label: 'MA10', children: formatNumber(anchor.inputs?.ma10, 4) },
            { key: 'support', label: '支撑 / 压力', children: `${formatNumber(anchor.inputs?.support, 4)} / ${formatNumber(anchor.inputs?.resistance, 4)}` },
          ]} />
        </Card>
        <Card size="small" title="三、网格间距">
          <Descriptions size="small" column={1} items={[
            { key: 'policy', label: '间距策略', children: spacing.policy || '未记录' },
            { key: 'atr', label: 'ATR14', children: formatNumber(spacing.atr14, 4) },
            { key: 'raw', label: '原始间距', children: `${formatNumber(spacing.rawPercent, 4)}%` },
            { key: 'range', label: '允许范围', children: `${formatNumber(spacing.minPercent, 2)}% – ${formatNumber(spacing.maxPercent, 2)}%` },
            { key: 'final', label: '最终间距', children: `${formatNumber(spacing.finalPercent, 4)}% / ${formatNumber(spacing.absoluteAmount, 4)}` },
          ]} />
        </Card>
        <Card size="small" title="四、数量与资金约束">
          <Descriptions size="small" column={1} items={[
            { key: 'cash', label: '现金预算', children: formatMoney(sizing.cashBudget) },
            { key: 'floor', label: '现金底线后余额', children: formatMoney(sizing.cashAfterFloor) },
            { key: 'capacity', label: '仓位容量', children: formatMoney(sizing.weightCapacity) },
            { key: 'buy', label: '本标的买入预算', children: formatMoney(sizing.buyBudget) },
            { key: 'sell', label: '允许卖出数量', children: formatNumber(sizing.sellQuantity, 0) },
            { key: 'lot', label: '最小交易单位', children: formatNumber(sizing.lotSize, 2) },
            { key: 'weights', label: '分档权重', children: (sizing.levelWeights || []).join(' / ') || '未记录' },
          ]} />
        </Card>
      </div>
      <Card size="small" title="五、风险门禁与最终输出">
        <div className="grid gap-3 md:grid-cols-3">
          {([['全局门禁', gates.global], ['买入门禁', gates.buy], ['卖出门禁', gates.sell]] as const).map(([label, values]) => (
            <div key={label} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500">{label}</div>
              <div className="mt-2 flex flex-wrap gap-1">{values?.length ? values.map((item: string) => <Tag key={item} color="warning">{blockerLabel(item)}</Tag>) : <Tag color="success">通过</Tag>}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          输出：{asset.orders?.length ? `形成 ${asset.orders.length} 档人工计划草案，页面价格和数量直接读取已保存的 GridOrderDraft。` : '没有满足全部门禁的订单，保持观察。'}
        </div>
      </Card>
    </div>
  )
}

export function DailyReviewDecisionPanel({
  decisionSummary,
  llmSynthesis,
  attentionCandidates,
  onOpenAttentionAudit,
}: {
  decisionSummary?: any
  llmSynthesis?: any
  attentionCandidates: any[]
  onOpenAttentionAudit: (symbol: string, evidenceRefs: string[]) => void
}) {
  if (!decisionSummary) return <Alert type="info" showIcon message="该历史复盘生成于结论摘要功能上线前" description="原始行情和网格仍可审查，但没有保存 v2 可复算推导链。" />
  const assets = decisionSummary.assets || []
  const orderRows = assets.flatMap((asset: any) => (asset.orders || []).map((order: any) => ({ ...order, symbol: asset.symbol, name: asset.name, key: order.id || `${asset.symbol}:${order.side}:${order.level}` })))
  const synthesisBySymbol = new Map((llmSynthesis?.attentionSummaries || []).map((item: any) => [item.symbol, item]))
  const copyOrders = async () => {
    const text = orderRows.length
      ? orderRows.map((row: any) => `${row.symbol} ${row.side === 'buy' ? '买入' : '卖出'} ${row.price} × ${row.quantity}，有效至 ${formatDateTime(row.validUntil)}`).join('\n')
      : '本轮没有可人工设置的订单草案。'
    await navigator.clipboard.writeText(text)
    message.success('人工计划设置清单已复制')
  }
  const columns: ColumnsType<any> = [
    { title: '标的', dataIndex: 'symbol', width: 130, render: (symbol, row) => <div><strong>{symbol}</strong><div className="text-xs text-slate-500">{row.name}</div></div> },
    { title: '方向', dataIndex: 'side', width: 90, render: (side) => <Tag color={side === 'buy' ? 'red' : 'green'}>{side === 'buy' ? '买入' : '卖出'}</Tag> },
    { title: '档位', dataIndex: 'level', width: 70 },
    { title: '价格', dataIndex: 'price', width: 100, align: 'right', render: (value) => formatNumber(value, 4) },
    { title: '数量', dataIndex: 'quantity', width: 100, align: 'right', render: (value) => formatNumber(value, 0) },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: formatMoney },
    { title: '有效期', dataIndex: 'validUntil', width: 180, render: formatDateTime },
    { title: '冲突', dataIndex: 'conflictStatus', width: 130, render: (value) => <Tag color={value === 'none' ? 'success' : 'warning'}>{value || 'none'}</Tag> },
  ]

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-blue-100 bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 text-white" styles={{ body: { padding: 24 } }} data-testid="daily-review-decision-summary">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">本轮具体结论</div>
            <h2 className="mb-0 mt-2 text-2xl font-semibold text-white">{llmSynthesis?.headline || decisionSummary.headline}</h2>
            <p className="mb-0 mt-3 text-sm leading-7 text-blue-100">{llmSynthesis?.overview || decisionSummary.headline}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag color={llmSynthesis?.source === 'llm' ? 'blue' : 'default'} icon={<RobotOutlined />}>{llmSynthesis?.source === 'llm' ? `LLM 已汇总 · ${llmSynthesis.model}` : `规则摘要 · ${llmSynthesis?.failureCode || 'legacy'}`}</Tag>
              <Tag color="warning" icon={<SafetyCertificateOutlined />}>仅人工计划草案</Tag>
            </div>
          </div>
          <div className="grid min-w-[340px] grid-cols-2 gap-3">
            <Card size="small"><Statistic title="买入草案" value={decisionSummary.counts?.buyDrafts || 0} /></Card>
            <Card size="small"><Statistic title="卖出草案" value={decisionSummary.counts?.sellDrafts || 0} /></Card>
            <Card size="small"><Statistic title="观察标的" value={decisionSummary.counts?.observeAssets || 0} /></Card>
            <Card size="small"><Statistic title="高优先级" value={decisionSummary.highPrioritySymbols?.length || 0} /></Card>
          </div>
        </div>
      </Card>

      <Card className="fams-card" data-testid="manual-order-plan">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">MANUAL ORDER PLAN</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">具体如何设置买卖单</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-500">准确读取本轮已保存的 GridOrderDraft；复制后仍需在券商端人工核对，不会自动提交。</p></div>
          <Button icon={<CopyOutlined />} disabled={!orderRows.length} onClick={() => void copyOrders()}>复制设置清单</Button>
        </div>
        {orderRows.length ? <Table columns={columns} dataSource={orderRows} pagination={false} size="small" scroll={{ x: 1050 }} /> : <Empty description="本轮全部为观察模式，没有可设置订单" />}
      </Card>

      <Card className="fams-card" data-testid="attention-synthesis">
        <div className="mb-4"><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">ATTENTION SYNTHESIS</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">需要关注的标的</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-500">正文已经过一次受控汇总；原始证据标识只在高级审计中展示。</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {attentionCandidates.map((candidate: any) => {
            const summary: any = synthesisBySymbol.get(candidate.symbol)
            const asset = assets.find((item: any) => item.symbol === candidate.symbol)
            const action = actionMeta[asset?.action] || actionMeta.observe
            const evidenceRefs = summary?.evidenceRefs?.length ? summary.evidenceRefs : candidate.evidenceRefs || []
            return (
              <div key={`${candidate.symbol}:${candidate.source}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-lg font-semibold text-slate-950">{candidate.symbol} · {candidate.name}</div><div className="mt-1 text-xs text-slate-500">{candidate.source === 'holding' ? '当前持仓' : '候选池'}</div></div><Tag color={action.color}>{action.label}</Tag></div>
                <p className="mb-0 mt-3 text-sm leading-6 text-slate-700">{summary?.summary || candidate.reason}</p>
                {summary?.reasons?.length ? <ul className="mb-0 mt-2 pl-5 text-sm leading-6 text-slate-600">{summary.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul> : null}
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{summary?.risk || (candidate.evidenceStatus === 'available' ? '证据可用，但仍需人工复核。' : '证据不完整，不据此提高仓位。')}</div>
                <Button className="mt-3 px-0" type="link" icon={<AuditOutlined />} onClick={() => onOpenAttentionAudit(candidate.symbol, evidenceRefs)}>查看原始证据（{evidenceRefs.length}）</Button>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="fams-card" data-testid="grid-derivation-traces">
        <div className="mb-4"><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">REPRODUCIBLE TRACE</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">为什么得到这些价格和数量</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-500">价值评估只提供风险背景；实际价格由技术锚和波动间距生成，数量由资金与仓位约束生成。</p></div>
        <Collapse items={assets.map((asset: any) => ({
          key: asset.symbol,
          label: <div className="flex flex-wrap items-center gap-2"><strong>{asset.symbol} · {asset.name}</strong><Tag color={(actionMeta[asset.action] || actionMeta.observe).color}>{(actionMeta[asset.action] || actionMeta.observe).label}</Tag><span className="text-xs text-slate-500">锚点 {formatNumber(asset.gridDerivation?.anchor?.value, 4)} · 间距 {formatNumber(asset.gridDerivation?.spacing?.finalPercent, 2)}%</span></div>,
          children: <DerivationContent asset={asset} />,
        }))} />
      </Card>
    </div>
  )
}
