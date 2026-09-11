import { Alert, Card, Descriptions, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'

const text = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)

function RuleList({ rows, empty }: { rows: any[]; empty: string }) {
  return rows.length ? <div className="space-y-2">{rows.map((row, index) => (
    <div key={`${row.symbol || row.role || 'row'}:${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
      {row.symbol ? <Tag>{row.symbol}</Tag> : null}{row.message || row.rule || row.reason || JSON.stringify(row)}
    </div>
  ))}</div> : <div className="text-sm text-slate-500">{empty}</div>
}

export function BrokerReconciliationPanel({ reconciliation }: { reconciliation?: any }) {
  if (!reconciliation) return null
  const facts = reconciliation.confirmedFacts || {}
  const readiness = reconciliation.readiness || {}
  const proposed = reconciliation.proposedOrders || {}
  const positions = facts.positions || []
  const orderRows = [
    ...(proposed.retained || []).map((row: any) => ({ ...row, bucket: '拟保留' })),
    ...(proposed.cancelCandidates || []).map((row: any) => ({ ...row, bucket: '拟撤销' })),
    ...(proposed.addCandidates || []).map((row: any) => ({ ...row, bucket: '拟新增/查重' })),
    ...(proposed.blocked || []).map((row: any) => ({ ...row, bucket: '阻断' })),
  ]
  const positionColumns: ColumnsType<any> = [
    { title: '代码', dataIndex: 'symbol', width: 90 },
    { title: '名称', dataIndex: 'name', width: 110 },
    { title: '持仓', dataIndex: 'quantity', align: 'right' },
    { title: '可卖', dataIndex: 'sellableQuantity', align: 'right' },
    { title: '冻结', dataIndex: 'frozenQuantity', align: 'right' },
    { title: '成本', dataIndex: 'avgCost', align: 'right' },
    { title: '截图价', dataIndex: 'screenshotPrice', align: 'right' },
    { title: '事实来源', dataIndex: 'sourceRef', width: 230, ellipsis: true },
  ]
  const orderColumns: ColumnsType<any> = [
    { title: '分类', dataIndex: 'bucket', width: 110, render: (value) => <Tag color={value === '阻断' ? 'error' : value === '拟新增/查重' ? 'warning' : 'blue'}>{value}</Tag> },
    { title: '代码', dataIndex: 'symbol', width: 90 },
    { title: '方向', dataIndex: 'side', width: 80 },
    { title: '委托类型', dataIndex: 'orderKind', width: 100, render: (value) => value === 'conditional' ? '条件单' : '普通委托' },
    { title: '价格', dataIndex: 'price', align: 'right' },
    { title: '数量', dataIndex: 'quantity', align: 'right' },
    { title: '说明', key: 'message', width: 360, render: (_value, row) => row.message || row.blocker || row.purpose || '需人工核对' },
  ]

  return <Card className="fams-card" styles={{ body: { padding: 20 } }} data-testid="broker-reconciliation-report">
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
      <div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">BROKER RECONCILIATION</div><h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">券商五段式对账报告</h2></div>
      <Tag color={readiness.requiredInputsReady ? readiness.ordersFullyReconciled ? 'success' : 'warning' : 'error'}>{readiness.draftStatus || 'unknown'}</Tag>
    </div>
    <Alert
      type={readiness.requiredInputsReady ? readiness.ordersFullyReconciled ? 'success' : 'warning' : 'error'}
      showIcon
      message={readiness.requiredInputsReady ? '持仓与新成交已对账' : '强制材料未就绪，订单草案保持阻断'}
      description={readiness.ordersFullyReconciled ? '普通委托和条件单均已核对。' : '委托截图为可选材料；缺失时只能生成“人工查重”候选，不能给出确定的新增结论。'}
    />

    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2"><h3 className="mt-0 text-base font-semibold">1. 已确认事实</h3>
        <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 4 }} items={[
          { key: 'cash', label: '可用资金', children: text(facts.account?.availableCash) },
          { key: 'positions', label: '持仓数', children: positions.length },
          { key: 'pairs', label: '待闭合网格批次', children: facts.openGridPairs?.length || 0 },
          { key: 'history', label: '历史成交处理', children: facts.doNotReplayHistoricalFills ? '已进快照，不重放' : '待核对' },
        ]} />
        <Table className="mt-3" size="small" pagination={false} rowKey={(row) => `${row.symbol}:${row.sourceRef}`} columns={positionColumns} dataSource={positions} scroll={{ x: 980 }} />
      </section>
      <section className="rounded-xl border border-slate-200 p-4"><h3 className="mt-0 text-base font-semibold">2. 对账差异</h3><RuleList rows={reconciliation.reconciliationDifferences || []} empty="没有记录到对账差异。" /></section>
      <section className="rounded-xl border border-slate-200 p-4"><h3 className="mt-0 text-base font-semibold">3. 待确认规则</h3><RuleList rows={reconciliation.pendingRules || []} empty="没有待确认规则。" /></section>
      <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2"><h3 className="mt-0 text-base font-semibold">4. 拟保留／撤销／新增订单</h3><p className="text-sm text-slate-500">交接文档内的助手价格不会自动变成有效委托；所有结果仍需在同花顺人工核对与执行。</p><Table size="small" pagination={false} rowKey={(row, index) => `${row.bucket}:${row.proposalId || row.existingOrderId || index}`} columns={orderColumns} dataSource={orderRows} scroll={{ x: 1080 }} /></section>
      <section className="rounded-xl border border-red-200 bg-red-50/50 p-4 xl:col-span-2"><h3 className="mt-0 text-base font-semibold text-red-950">5. 执行权限</h3><div className="flex flex-wrap gap-2"><Tag color="blue">只读</Tag><Tag color="blue">提醒</Tag><Tag color="blue">拟单</Tag><Tag color="error">正式交易未解锁</Tag><Tag color="error">自动交易未解锁</Tag><Tag color="error">不能创建券商订单</Tag></div></section>
    </div>
  </Card>
}
