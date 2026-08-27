import { Alert, Button, Card, Collapse, Descriptions, Statistic, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AuditOutlined, ClockCircleOutlined, CopyOutlined, LinkOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

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

const focusAssets = [
  { symbol: '601127', name: '赛力斯' },
  { symbol: '600276', name: '恒瑞医药' },
  { symbol: '159851', name: '金科ETF' },
  { symbol: '513770', name: '港股互联网' },
] as const

const parseObject = (value: unknown) => {
  if (value && typeof value === 'object') return value as Record<string, any>
  try { return typeof value === 'string' ? JSON.parse(value) as Record<string, any> : {} } catch { return {} }
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
  session_closed: '今日已收盘，请下一交易时段重新运行',
  parent_sell_draft_unavailable: '本轮没有可绑定的父卖单',
  grid_spacing_invalid: '网格间距无效，无法生成条件买回',
  completed_history_insufficient: '完整历史行情不足',
  market_data_confidence_low: '行情置信度不足',
  observe_only_strategy: '当前策略仅观察',
}[value] || value)

const blockerText = (values: unknown) => {
  const blockers = Array.isArray(values) ? [...new Set(values.map(String))] : []
  return blockers.length ? blockers.map(blockerLabel).join('；') : '本轮没有形成有效档位，请查看推导与门禁。'
}

const pricePoints = (orders: any[], side?: string) => {
  const values = orders.filter((order) => !side || order.side === side).map((order) => formatNumber(order.price, 4))
  return values.length ? values.join(' / ') : '—'
}

function DerivationContent({ asset }: { asset: any }) {
  const derivation = asset.gridDerivation || {}
  const anchor = derivation.anchor || {}
  const spacing = derivation.spacing || {}
  const sizing = derivation.sizing || {}
  const tradingRules = derivation.tradingRules || {}
  const validity = derivation.validity || {}
  const gates = derivation.gates || { global: [], buy: [], sell: [] }
  const valuation = asset.valuationContext || {}
  const conditionalBuyback = asset.conditionalBuyback || {}
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
            { key: 'portfolioBefore', label: '组合预算（分配前）', children: formatMoney(sizing.portfolioBudgetRemainingBefore) },
            { key: 'used', label: '本标的即时买单金额', children: formatMoney(sizing.immediateBuyAmount) },
            { key: 'portfolioAfter', label: '组合预算（分配后）', children: formatMoney(sizing.portfolioBudgetRemainingAfter) },
            { key: 'sell', label: '允许卖出数量', children: formatNumber(sizing.sellQuantity, 0) },
            { key: 'lot', label: '最小交易单位', children: formatNumber(sizing.lotSize, 2) },
            { key: 'weights', label: '分档权重', children: (sizing.levelWeights || []).join(' / ') || '未记录' },
          ]} />
        </Card>
        <Card size="small" title="五、交易规则与有效期">
          <Descriptions size="small" column={1} items={[
            { key: 'market', label: '市场', children: tradingRules.market || '未记录' },
            { key: 'tick', label: '价格步长', children: formatNumber(tradingRules.priceTick, 4) },
            { key: 'rounding', label: '价格取整', children: '买入向下 / 卖出向上' },
            { key: 'lot', label: '整手单位', children: formatNumber(tradingRules.lotSize, 2) },
            { key: 'allocation', label: '数量分档', children: '总可交易量整手化后按最大余数分配' },
            { key: 'policy', label: '有效期策略', children: validity.policy === 'session_close' ? '生成当日收盘失效' : validity.policy || '未记录' },
            { key: 'until', label: '有效至', children: formatDateTime(validity.validUntil) },
          ]} />
        </Card>
        <Card size="small" title="六、卖出后条件买回">
          <Descriptions size="small" column={1} items={[
            { key: 'status', label: '状态', children: conditionalBuyback.status || '旧报告未记录' },
            { key: 'formula', label: '公式', children: conditionalBuyback.derivation?.formula === 'parent_sell_price - one_final_grid_spacing' ? '父卖价 − 一个本轮最终网格间距' : '未记录' },
            { key: 'count', label: '父子绑定', children: `${conditionalBuyback.orders?.length || 0} 档` },
            { key: 'cash', label: '即时现金占用', children: '父卖单确认成交前为 0' },
            { key: 'validUntil', label: '有效至', children: formatDateTime(conditionalBuyback.orders?.[0]?.validUntil || conditionalBuyback.derivation?.validity?.validUntil) },
          ]} />
          {conditionalBuyback.blockers?.length ? <div className="mt-3 text-xs leading-5 text-amber-700">{blockerText(conditionalBuyback.blockers)}</div> : null}
        </Card>
      </div>
      <Card size="small" title="七、风险门禁与最终输出">
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
  const conditionalRows = assets.flatMap((asset: any) => (asset.conditionalBuyback?.orders || []).map((order: any) => {
    const trigger = parseObject(order.triggerCondition)
    return { ...order, trigger, symbol: asset.symbol, name: asset.name, key: order.id || `${asset.symbol}:conditional:${order.level}` }
  }))
  const synthesisBySymbol = new Map((llmSynthesis?.attentionSummaries || []).map((item: any) => [item.symbol, item]))
  const copyOrders = async () => {
    const text = orderRows.length
      ? orderRows.map((row: any) => `${row.symbol} ${row.side === 'buy' ? '买入' : '卖出'} ${row.price} × ${row.quantity}，有效至 ${formatDateTime(row.validUntil)}`).join('\n')
      : '本轮没有可人工设置的订单草案。'
    await navigator.clipboard.writeText(text)
    message.success('人工计划设置清单已复制')
  }
  const copyConditionalOrders = async () => {
    const text = conditionalRows.length
      ? conditionalRows.map((row: any) => `${row.symbol}：仅在父卖单第 ${row.trigger.parentSellLevel ?? row.level} 档 ${row.trigger.parentSellPrice ?? '—'} 成交 ${row.trigger.requiredFilledQuantity ?? row.quantity} 后，再人工核对买回 ${row.price} × ${row.quantity}；有效至 ${formatDateTime(row.validUntil)}`).join('\n')
      : '本轮没有卖出成交后条件买回草案。'
    await navigator.clipboard.writeText(text)
    message.success('条件买回清单已复制')
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
  const conditionalColumns: ColumnsType<any> = [
    { title: '标的', dataIndex: 'symbol', width: 130, render: (symbol, row) => <div><strong>{symbol}</strong><div className="text-xs text-slate-500">{row.name}</div></div> },
    { title: '父卖档', width: 90, render: (_value, row) => `第 ${row.trigger.parentSellLevel ?? row.level} 档` },
    { title: '父卖价', width: 100, align: 'right', render: (_value, row) => formatNumber(row.trigger.parentSellPrice, 4) },
    { title: '要求成交', width: 100, align: 'right', render: (_value, row) => formatNumber(row.trigger.requiredFilledQuantity, 0) },
    { title: '成交后买回价', dataIndex: 'price', width: 130, align: 'right', render: (value) => <strong className="text-blue-800">{formatNumber(value, 4)}</strong> },
    { title: '买回数量', dataIndex: 'quantity', width: 100, align: 'right', render: (value) => formatNumber(value, 0) },
    { title: '有效期', dataIndex: 'validUntil', width: 180, render: formatDateTime },
    { title: '状态', dataIndex: 'status', width: 155, render: () => <Tag color="gold" icon={<LinkOutlined />}>父卖单成交后激活</Tag> },
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
            <Card size="small"><Statistic title="成交后买回" value={decisionSummary.counts?.conditionalBuybackDrafts || 0} /></Card>
            <Card size="small"><Statistic title="观察标的" value={decisionSummary.counts?.observeAssets || 0} /></Card>
          </div>
        </div>
      </Card>

      <Card className="fams-card" data-testid="focus-buyback-points">
        <div className="mb-4"><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">FOCUS BUYBACK POINTS</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">四个重点标的：现在看什么价</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-500">只投影本轮已保存草案。若当日已收盘或证据门禁未通过，会直接说明原因，不把过期价伪装成可挂单。</p></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {focusAssets.map((focus) => {
            const asset = assets.find((item: any) => item.symbol === focus.symbol)
            const immediate = asset?.orders || []
            const conditional = asset?.conditionalBuyback?.orders || []
            const blockers = [...(asset?.blockers || []), ...(asset?.conditionalBuyback?.blockers || [])]
            return (
              <div key={focus.symbol} className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4" data-testid={`focus-asset-${focus.symbol}`}>
                <div className="flex items-start justify-between gap-3"><div><div className="text-lg font-semibold text-slate-950">{focus.symbol}</div><div className="text-sm text-slate-500">{asset?.name || focus.name}</div></div><Tag color={immediate.length ? 'blue' : 'default'}>{immediate.length ? '有当日草案' : '当前观察'}</Tag></div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-100 p-2"><div className="text-xs text-slate-500">最新价</div><div className="mt-1 font-semibold text-slate-900">{formatNumber(asset?.currentPrice, 4)}</div></div>
                  <div className="rounded-lg bg-red-50 p-2"><div className="text-xs text-red-600">即时买点</div><div className="mt-1 font-semibold text-red-800">{pricePoints(immediate, 'buy')}</div></div>
                  <div className="rounded-lg bg-emerald-50 p-2"><div className="text-xs text-emerald-700">即时卖点</div><div className="mt-1 font-semibold text-emerald-900">{pricePoints(immediate, 'sell')}</div></div>
                  <div className="rounded-lg bg-blue-50 p-2"><div className="text-xs text-blue-700">卖出后买回</div><div className="mt-1 font-semibold text-blue-900">{pricePoints(conditional, 'buy')}</div></div>
                </div>
                {!immediate.length && !conditional.length ? <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{asset ? blockerText(blockers) : '本轮该标的处理失败或未进入成功资产清单。'}</div> : null}
                <div className="mt-3 text-xs leading-5 text-slate-500">较上一轮：{asset?.adjustment?.reasons?.join('；') || '没有可比较记录。'}</div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="fams-card" data-testid="manual-order-plan">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">IMMEDIATE MANUAL PLAN</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">现在可人工核对的买卖单</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-500">只包含本轮已保存的即时 GridOrderDraft；复制后仍需在券商端人工核对，不会自动提交。</p></div>
          <Button icon={<CopyOutlined />} disabled={!orderRows.length} onClick={() => void copyOrders()}>复制设置清单</Button>
        </div>
        {orderRows.length ? <Table columns={columns} dataSource={orderRows} pagination={false} size="small" scroll={{ x: 1050 }} /> : <Alert type="warning" showIcon icon={<ClockCircleOutlined />} message="本轮没有当前有效的即时草案" description={blockerText(assets.flatMap((asset: any) => asset.blockers || []))} />}
      </Card>

      <Card className="fams-card border-amber-200 bg-amber-50/30" data-testid="conditional-buyback-plan">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">AFTER SELL FILL</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">卖出成交后再人工设置的买回单</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-600">这些草案当前未激活、当前不占现金。必须先核对对应父卖单已经成交，再重新确认行情和有效期。</p></div>
          <Button icon={<CopyOutlined />} disabled={!conditionalRows.length} onClick={() => void copyConditionalOrders()}>复制条件买回清单</Button>
        </div>
        {conditionalRows.length ? <Table columns={conditionalColumns} dataSource={conditionalRows} pagination={false} size="small" scroll={{ x: 1080 }} /> : <Alert type="info" showIcon message="本轮没有可绑定的条件买回草案" description={blockerText(assets.flatMap((asset: any) => asset.conditionalBuyback?.blockers || []))} />}
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
