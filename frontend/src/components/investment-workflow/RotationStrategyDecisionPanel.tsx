import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Empty, Space, Spin, Tag } from 'antd'
import { AuditOutlined, CheckCircleOutlined, RadarChartOutlined, RightOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config/api'

type Assignment = {
  positionId: string
  strategyFamily: string
  status: string
  position?: { asset?: { symbol?: string; name?: string } }
}

type StrategyResult = {
  conclusion: { status: 'ready' | 'observe' | 'blocked' | 'insufficient'; title: string; summary: string }
  dataHealth: { status: string; providers: string[]; warnings: string[] }
  signalLayers: Array<{ id: string; label: string; status: string; value: string | number | boolean | null; reason: string }>
  previousPlanComparison: { disposition: string; reasons: string[] } | null
  manualOrderDrafts: Array<{ side: string; price: number; quantity: number; validUntil: string; rationale: string; createsOrder: false }>
  blockedReasons: string[]
}

type StrategyRun = {
  inputSnapshotId: string
  snapshotHash: string
  targets: Array<{ positionId: string; symbol: string; name: string; result: StrategyResult }>
  transactionSideEffectCount: number
}

const statusMeta: Record<string, { color: string; label: string }> = {
  ready: { color: 'success', label: '人工计划已就绪' },
  observe: { color: 'processing', label: '继续观察' },
  blocked: { color: 'error', label: '已阻断' },
  insufficient: { color: 'warning', label: '证据不足' },
  passed: { color: 'success', label: '通过' },
  failed: { color: 'error', label: '未通过' },
  not_applicable: { color: 'default', label: '不适用' },
}

export function RotationStrategyDecisionPanel({ userId = 'default' }: { userId?: string }) {
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [run, setRun] = useState<StrategyRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${API_BASE}/api/v1/investment-workflow/assignments?userId=${encodeURIComponent(userId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => setAssignments(payload.assignments || []))
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : String(reason || '')
        const aborted = controller.signal.aborted
          || (reason instanceof DOMException && reason.name === 'AbortError')
          || /\babort(?:ed|ing)?\b/i.test(message)
        if (aborted) return
        setError(message || '策略归类状态读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [userId])

  const confirmed = useMemo(
    () => assignments.filter((item) => item.strategyFamily === 'rotation_volatility' && item.status === 'confirmed'),
    [assignments],
  )

  const execute = async () => {
    setRunning(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/v1/investment-workflow/strategy-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, strategyFamily: 'rotation_volatility', positionIds: confirmed.map((item) => item.positionId) }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`)
      setRun(payload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '轮动策略运行失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="fams-decision-panel" aria-label="行业轮动策略结论" data-testid="rotation-strategy-decision-panel">
      <Card
        title={<Space><RadarChartOutlined className="text-blue-600" /><span>行业轮动策略结论</span></Space>}
        extra={<Tag icon={<SafetyCertificateOutlined />}>只生成人工计划</Tag>}
      >
        {loading ? <div className="py-8 text-center"><Spin /></div> : confirmed.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚无已确认的行业轮动/波动仓资产，系统不会替你决定策略归类。"
          >
            <Button type="primary" onClick={() => navigate('/positions')}>前往仓位管理确认归类 <RightOutlined /></Button>
          </Empty>
        ) : (
          <>
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message={`已确认 ${confirmed.length} 项资产。运行后按 RRG → 均线 → MACD → 成交量 → ATR/交易单位逐层检查。`}
              description="已有网格优先复核；缺少最新报价时只给观察结论，不生成精确价格和数量。"
            />
            <Button type="primary" icon={<AuditOutlined />} loading={running} onClick={() => void execute()}>运行已确认资产</Button>
          </>
        )}
        {error && <Alert className="mt-4" type="error" showIcon message="策略运行未完成" description={error} />}
        {run && (
          <div className="mt-5 space-y-4" data-testid="rotation-strategy-results">
            {run.targets.map((target) => {
              const meta = statusMeta[target.result.conclusion.status] || { color: 'default', label: target.result.conclusion.status }
              return (
                <article key={target.positionId} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500">{target.symbol}</div>
                      <h3 className="mb-0 mt-1 text-base font-semibold text-slate-950">{target.result.conclusion.title}</h3>
                    </div>
                    <Tag color={meta.color}>{meta.label}</Tag>
                  </div>
                  <p className="mb-0 mt-3 text-sm leading-6 text-slate-700">{target.result.conclusion.summary}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {target.result.signalLayers.map((layer) => {
                      const layerMeta = statusMeta[layer.status] || { color: 'default', label: layer.status }
                      return (
                        <div key={layer.id} className="rounded-md border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{layer.label}</span><Tag color={layerMeta.color}>{layerMeta.label}</Tag></div>
                          <div className="mt-2 text-xs leading-5 text-slate-600">{layer.reason}</div>
                        </div>
                      )
                    })}
                  </div>
                  {target.result.manualOrderDrafts.length > 0 && (
                    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <div className="font-medium text-emerald-950"><CheckCircleOutlined /> 人工设置清单</div>
                      {target.result.manualOrderDrafts.map((draft, index) => (
                        <div key={`${draft.side}-${draft.price}-${index}`} className="mt-2 text-sm text-emerald-950">{draft.side} · {draft.price} · {draft.quantity} · 有效至 {new Date(draft.validUntil).toLocaleString('zh-CN')}</div>
                      ))}
                    </div>
                  )}
                  <Collapse
                    className="mt-4"
                    ghost
                    items={[{
                      key: 'evidence',
                      label: '数据来源、阻断原因与审计引用',
                      children: (
                        <div className="space-y-2 text-xs leading-5 text-slate-600">
                          <div>数据状态：{target.result.dataHealth.status} · provider：{target.result.dataHealth.providers.join('、')}</div>
                          <div>阻断：{target.result.blockedReasons.length > 0 ? target.result.blockedReasons.join('、') : '无'}</div>
                          <div>快照：{run.inputSnapshotId} · hash {run.snapshotHash.slice(0, 16)}…</div>
                          <div>交易副作用：{run.transactionSideEffectCount}；不会创建或提交订单。</div>
                        </div>
                      ),
                    }]}
                  />
                </article>
              )
            })}
          </div>
        )}
      </Card>
    </section>
  )
}
