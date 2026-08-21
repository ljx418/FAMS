import { Drawer, Input, Segmented, Tag } from 'antd'
import type { ReviewWorkflowNode } from './DailyReviewWorkflowDag'
import { RuntimeStatusTag } from './DailyReviewWorkflowDag'

type ReviewStatus = 'pending' | 'pass' | 'issue'
type ReviewAnnotation = { status: ReviewStatus; note: string; updatedAt: string }

const evidenceLabel = (ref: string) => {
  if (ref.startsWith('financial-report:')) return '财务报告事实'
  if (ref.startsWith('stock-factset-cache:')) return '股票深度事实缓存'
  if (ref.startsWith('quote-list-canonical:')) return '估值与行情基线'
  if (ref.startsWith('market-provider:')) return '实时行情来源'
  if (ref.startsWith('market-feature-daily:')) return '日频市场特征'
  if (ref.startsWith('grid-plan:')) return '网格计划快照'
  if (ref.startsWith('position:')) return '持仓事实'
  if (ref.startsWith('asset:')) return '资产主数据'
  if (ref.startsWith('portfolio:')) return '组合快照'
  if (ref.startsWith('news:')) return '消息事件事实'
  if (ref.startsWith('fundamental:')) return '基本面事实'
  if (ref.startsWith('daily-review:')) return '历史复盘运行'
  if (ref.startsWith('operation:')) return '审计任务运行'
  if (ref.startsWith('capture:')) return '已确认截图'
  if (ref === 'executionBoundary') return '执行边界'
  return '审计证据'
}

export function DailyReviewAuditDrawer({
  open,
  node,
  annotation,
  focusSymbol,
  focusEvidenceRefs,
  onClose,
  onChangeAnnotation,
}: {
  open: boolean
  node?: ReviewWorkflowNode
  annotation?: ReviewAnnotation
  focusSymbol?: string
  focusEvidenceRefs?: string[]
  onClose: () => void
  onChangeAnnotation: (patch: Partial<Pick<ReviewAnnotation, 'status' | 'note'>>) => void
}) {
  const evidenceRefs = focusEvidenceRefs?.length ? focusEvidenceRefs : node?.evidenceRefs || []
  return (
    <Drawer title="高级审计" width={560} open={open} onClose={onClose} data-testid="daily-review-audit-drawer">
      {node ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-wider text-blue-700">NODE {String(node.sequence).padStart(2, '0')}</div>
                <h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">{node.title}</h2>
              </div>
              <div className="flex flex-wrap gap-2"><RuntimeStatusTag status={node.status} /><Tag color={node.provenance === 'runtime_record' ? 'blue' : 'purple'}>{node.provenance}</Tag></div>
            </div>
            {focusSymbol ? <div className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-600">当前证据筛选：<strong className="text-slate-950">{focusSymbol}</strong></div> : null}
          </section>

          <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-4" data-testid="node-review-annotation">
            <div className="font-semibold text-slate-950">本地节点审阅</div>
            <p className="mb-3 mt-1 text-xs leading-5 text-slate-500">只保存在当前浏览器并进入导出文件，不是正式发布签核，也不会改变运行记录。</p>
            <Segmented
              block
              aria-label="节点审阅状态"
              value={annotation?.status || 'pending'}
              onChange={(value) => onChangeAnnotation({ status: value as ReviewStatus })}
              options={[{ label: '待审阅', value: 'pending' }, { label: '通过', value: 'pass' }, { label: '有问题', value: 'issue' }]}
            />
            <Input.TextArea
              className="mt-3"
              aria-label="节点审阅备注"
              value={annotation?.note || ''}
              autoSize={{ minRows: 3, maxRows: 7 }}
              placeholder="记录需要复核的证据或阻断项。"
              onChange={(event) => onChangeAnnotation({ note: event.target.value })}
            />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-950">阻断条件</h3>
            <div className="flex flex-wrap gap-2">
              {node.blockerCodes.length
                ? node.blockerCodes.map((code) => <Tag key={code} color={node.status === 'locked' ? 'blue' : 'warning'}>{code}</Tag>)
                : <Tag color="success">无阻断</Tag>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-950">原始证据</h3>
            <p className="mb-3 mt-0 text-xs leading-5 text-slate-500">正文使用可读摘要；原始引用仅在此处保留以供审计和导出。</p>
            <div className="space-y-2">
              {evidenceRefs.length ? evidenceRefs.map((ref) => (
                <div key={ref} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-medium text-slate-900">{evidenceLabel(ref)}</div>
                  <code className="mt-1 block break-all text-xs leading-5 text-slate-500">{ref}</code>
                </div>
              )) : <span className="text-sm text-slate-500">本节点没有额外证据引用。</span>}
            </div>
          </section>
        </div>
      ) : <div className="text-sm text-slate-500">请选择一个工作流节点。</div>}
    </Drawer>
  )
}
