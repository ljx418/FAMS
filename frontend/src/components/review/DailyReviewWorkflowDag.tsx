import { useMemo, useState } from 'react'
import { Button, Modal, Tag } from 'antd'
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
} from '@ant-design/icons'

export type ReviewWorkflowValue = { label: string; value: string; evidenceRef?: string }
export type ReviewWorkflowNode = {
  id: string
  sequence: number
  title: string
  purpose?: string
  dependsOn?: string[]
  status: 'complete' | 'partial' | 'blocked' | 'empty' | 'locked'
  provenance: 'runtime_record' | 'derived_view'
  inputs: ReviewWorkflowValue[]
  outputs: ReviewWorkflowValue[]
  evidenceRefs: string[]
  blockerCodes: string[]
}
export type ReviewWorkflowEdge = { id: string; source: string; target: string }

type ReviewStatus = 'pending' | 'pass' | 'issue'

const nodePositions: Record<string, { col: number; row: number }> = {
  trigger: { col: 0, row: 1 },
  positions: { col: 1, row: 1 },
  quotes: { col: 2, row: 0 },
  fundamentals: { col: 2, row: 2 },
  indicators: { col: 3, row: 0 },
  strategy: { col: 4, row: 1 },
  attention: { col: 5, row: 0 },
  grid: { col: 5, row: 2 },
  history: { col: 6, row: 1 },
  boundary: { col: 7, row: 1 },
}

const statusMeta = {
  complete: { label: '完整', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: <CheckCircleOutlined /> },
  partial: { label: '部分', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: <ExclamationCircleOutlined /> },
  blocked: { label: '阻断', className: 'border-rose-200 bg-rose-50 text-rose-700', icon: <ExclamationCircleOutlined /> },
  empty: { label: '空状态', className: 'border-slate-200 bg-slate-50 text-slate-600', icon: <ClockCircleOutlined /> },
  locked: { label: '已锁定', className: 'border-blue-200 bg-blue-50 text-blue-700', icon: <LockOutlined /> },
} as const

const reviewLabel: Record<ReviewStatus, string> = { pending: '待审阅', pass: '已通过', issue: '有问题' }

const WIDTH = 1260
const HEIGHT = 470
const NODE_WIDTH = 132
const NODE_HEIGHT = 92
const LEFT = 24
const TOP = 24
const COL_STEP = 154
const ROW_STEP = 154

function point(nodeId: string) {
  const position = nodePositions[nodeId] || { col: 0, row: 0 }
  return {
    x: LEFT + position.col * COL_STEP,
    y: TOP + position.row * ROW_STEP,
  }
}

function edgePath(edge: ReviewWorkflowEdge) {
  const source = point(edge.source)
  const target = point(edge.target)
  const x1 = source.x + NODE_WIDTH
  const y1 = source.y + NODE_HEIGHT / 2
  const x2 = target.x
  const y2 = target.y + NODE_HEIGHT / 2
  const bend = Math.max(26, (x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function ValueList({ values }: { values: ReviewWorkflowValue[] }) {
  return (
    <dl className="m-0 space-y-3">
      {values.map((item) => (
        <div key={`${item.label}:${item.value}`} className="grid grid-cols-[minmax(100px,0.8fr)_minmax(0,1.4fr)] gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
          <dt className="text-sm text-slate-500">{item.label}</dt>
          <dd className="m-0 break-words text-sm font-medium text-slate-950">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function DailyReviewWorkflowDag({
  nodes,
  edges,
  selectedNodeId,
  nodeReviewStatuses,
  onSelectNode,
  onOpenAudit,
}: {
  nodes: ReviewWorkflowNode[]
  edges: ReviewWorkflowEdge[]
  selectedNodeId: string
  nodeReviewStatuses: Record<string, ReviewStatus>
  onSelectNode: (nodeId: string) => void
  onOpenAudit: (nodeId: string) => void
}) {
  const [detailNodeId, setDetailNodeId] = useState<string>()
  const detailNode = nodes.find((node) => node.id === detailNodeId)
  const connected = useMemo(() => {
    const active = new Set([selectedNodeId])
    const ancestors = [selectedNodeId]
    while (ancestors.length) {
      const target = ancestors.shift()!
      for (const edge of edges.filter((item) => item.target === target)) {
        if (!active.has(edge.source)) {
          active.add(edge.source)
          ancestors.push(edge.source)
        }
      }
    }
    const descendants = [selectedNodeId]
    while (descendants.length) {
      const source = descendants.shift()!
      for (const edge of edges.filter((item) => item.source === source)) {
        if (!active.has(edge.target)) {
          active.add(edge.target)
          descendants.push(edge.target)
        }
      }
    }
    return active
  }, [edges, selectedNodeId])

  const openDetail = (node: ReviewWorkflowNode) => {
    onSelectNode(node.id)
    setDetailNodeId(node.id)
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-sm leading-6 text-slate-500">单击高亮依赖路径；双击节点查看作用、输入和输出。证据与审阅位于高级审计。</p>
        <Button icon={<AuditOutlined />} onClick={() => onOpenAudit(selectedNodeId)}>高级审计</Button>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_1px_1px,#cbd5e1_1px,transparent_0)] bg-[length:18px_18px] p-2" data-testid="workflow-dag" aria-label="每日复盘有向无环工作流">
        <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
          <svg className="pointer-events-none absolute inset-0" width={WIDTH} height={HEIGHT} aria-hidden="true">
            <defs>
              <marker id="daily-review-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
              <marker id="daily-review-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const active = connected.has(edge.source) && connected.has(edge.target)
              return <path key={edge.id} d={edgePath(edge)} fill="none" stroke={active ? '#2563eb' : '#94a3b8'} strokeWidth={active ? 2.5 : 1.5} markerEnd={`url(#${active ? 'daily-review-arrow-active' : 'daily-review-arrow'})`} />
            })}
          </svg>
          {nodes.map((node) => {
            const position = point(node.id)
            const selected = node.id === selectedNodeId
            const active = connected.has(node.id)
            const status = statusMeta[node.status]
            const review = nodeReviewStatuses[node.id] || 'pending'
            return (
              <button
                key={node.id}
                type="button"
                data-testid={`dag-node-${node.id}`}
                aria-label={`NODE ${String(node.sequence).padStart(2, '0')} ${node.title}，${status.label}，${reviewLabel[review]}`}
                aria-pressed={selected}
                onClick={(event) => {
                  onSelectNode(node.id)
                  if (event.detail >= 2) openDetail(node)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openDetail(node)
                  }
                }}
                className={`absolute rounded-xl border bg-white p-3 text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? 'border-blue-500 ring-2 ring-blue-100' : active ? 'border-blue-200' : 'border-slate-200 opacity-75 hover:opacity-100'}`}
                style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <div className="text-[10px] font-bold tracking-[0.12em] text-blue-700">NODE {String(node.sequence).padStart(2, '0')}</div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-950">{node.title}</div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${status.className}`}>{status.icon}{status.label}</span>
                  <span className={`text-[10px] ${review === 'issue' ? 'text-amber-700' : review === 'pass' ? 'text-emerald-700' : 'text-slate-400'}`}>{reviewLabel[review]}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <Modal
        title={detailNode ? `NODE ${String(detailNode.sequence).padStart(2, '0')} · ${detailNode.title}` : '节点详情'}
        open={Boolean(detailNode)}
        onCancel={() => setDetailNodeId(undefined)}
        footer={<Button type="primary" onClick={() => setDetailNodeId(undefined)}>关闭</Button>}
        width={760}
        data-testid="node-detail-modal"
      >
        {detailNode ? (
          <div className="space-y-4">
            <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-700">当前节点作用</div>
              <p className="mb-0 mt-2 text-sm leading-6 text-slate-700">{detailNode.purpose || '处理本轮复盘数据。'}</p>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-base font-semibold text-slate-950">节点输入</h3>
              <ValueList values={detailNode.inputs} />
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-base font-semibold text-slate-950">节点输出</h3>
              <ValueList values={detailNode.outputs} />
            </section>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

export function RuntimeStatusTag({ status }: { status: ReviewWorkflowNode['status'] }) {
  const meta = statusMeta[status]
  return <Tag className="m-0" color={status === 'complete' ? 'success' : status === 'partial' ? 'warning' : status === 'blocked' ? 'error' : status === 'locked' ? 'processing' : 'default'}>{meta.icon} {meta.label}</Tag>
}
