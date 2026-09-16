import { useCallback, useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BarChartOutlined, CheckCircleOutlined, RadarChartOutlined, ReloadOutlined, RiseOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config/api'

type StrategyFamily = 'rotation_volatility' | 'dividend_low_vol' | 'portfolio' | 'unclassified'

type Assignment = {
  id: string
  positionId: string
  strategyFamily: StrategyFamily
  status: 'suggested' | 'confirmed'
  confidence: number | null
  reasons: string[]
  position?: {
    id: string
    asset: { symbol: string; name: string; type: string }
  }
}

const STRATEGIES: Array<{ value: StrategyFamily; label: string }> = [
  { value: 'rotation_volatility', label: '行业轮动 / 波动网格' },
  { value: 'dividend_low_vol', label: '红利低波' },
  { value: 'portfolio', label: '投资组合' },
  { value: 'unclassified', label: '暂不归类' },
]

const strategyLabel = (value: StrategyFamily) => STRATEGIES.find((item) => item.value === value)?.label || value

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export function PositionStrategyAssignmentPanel({ userId = 'default' }: { userId?: string }) {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drafts, setDrafts] = useState<Record<string, StrategyFamily>>({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refreshSuggestions = false) => {
    setLoading(true)
    try {
      if (refreshSuggestions) {
        await requestJson('/api/v1/investment-workflow/strategy-assignments/suggest', {
          method: 'POST',
          body: JSON.stringify({ userId }),
        })
      }
      const result = await requestJson<{ assignments: Assignment[] }>(`/api/v1/investment-workflow/strategy-assignments?userId=${encodeURIComponent(userId)}`)
      setAssignments(result.assignments)
      setDrafts(Object.fromEntries(result.assignments.map((item) => [item.positionId, item.strategyFamily])))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取策略归类失败')
    } finally {
      setLoading(false)
    }
  }, [message, userId])

  useEffect(() => {
    void load(false)
  }, [load])

  const confirm = async (assignment: Assignment) => {
    setLoading(true)
    try {
      await requestJson(`/api/v1/investment-workflow/strategy-assignments/${encodeURIComponent(assignment.positionId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          strategyFamily: drafts[assignment.positionId] || assignment.strategyFamily,
          confirmedBy: 'fams_asset_page_user',
        }),
      })
      message.success('策略归类已确认；该操作不会创建订单或改变持仓。')
      await load(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '确认策略归类失败')
      setLoading(false)
    }
  }

  const columns: ColumnsType<Assignment> = [
    {
      title: '持仓',
      key: 'position',
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-950">{row.position?.asset.name || row.positionId}</div>
          <div className="text-xs text-slate-500">{row.position?.asset.symbol || '未匹配代码'} · {row.position?.asset.type || '未知类型'}</div>
        </div>
      ),
    },
    {
      title: '适用策略',
      key: 'strategyFamily',
      width: 250,
      render: (_, row) => row.status === 'confirmed' ? (
        <Tag color="green">{strategyLabel(row.strategyFamily)}</Tag>
      ) : (
        <Select
          aria-label={`${row.position?.asset.name || row.positionId}适用策略`}
          className="w-full"
          value={drafts[row.positionId] || row.strategyFamily}
          options={STRATEGIES}
          onChange={(value) => setDrafts((current) => ({ ...current, [row.positionId]: value }))}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: Assignment['status'], row) => value === 'confirmed'
        ? <Tag icon={<CheckCircleOutlined />} color="success">已确认</Tag>
        : <Tag color={Number(row.confidence || 0) >= 0.8 ? 'blue' : 'orange'}>待确认 {Math.round(Number(row.confidence || 0) * 100)}%</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, row) => row.status === 'confirmed'
        ? <span className="text-xs text-slate-500">需变更时重新归类</span>
        : <Button size="small" type="primary" onClick={() => void confirm(row)}>确认归类</Button>,
    },
  ]

  return (
    <section aria-label="持仓策略归类" data-testid="position-strategy-assignment-panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="fams-eyebrow">仓位策略入口</div>
          <h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">确认每项资产采用哪类研究策略</h2>
          <p className="fams-muted mb-0 mt-2 text-sm">系统按账户和资产标签给出建议。确认只决定研究入口，不会买卖、调仓或创建订单。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load(true)}>重新生成建议</Button>
      </div>
      <Alert
        className="mb-4"
        type={assignments.some((item) => item.status !== 'confirmed') ? 'warning' : 'success'}
        showIcon
        message={assignments.length === 0
          ? '当前没有可归类的开放持仓'
          : assignments.some((item) => item.status !== 'confirmed')
            ? `还有 ${assignments.filter((item) => item.status !== 'confirmed').length} 项资产需要确认`
            : '全部开放持仓已完成策略归类'}
      />
      <Table columns={columns} dataSource={assignments} rowKey="id" loading={loading} pagination={false} size="small" scroll={{ x: 720 }} />
      <div className="mt-4 border-t border-slate-200 pt-4" data-testid="position-strategy-next-actions">
        <div className="mb-3 text-sm font-semibold text-slate-950">下一步：运行对应研究</div>
        <div className="grid gap-2 md:grid-cols-3">
          <Button icon={<RadarChartOutlined />} onClick={() => navigate('/relative-rotation')}>
            轮动与波动仓（{assignments.filter((item) => item.status === 'confirmed' && item.strategyFamily === 'rotation_volatility').length}）
          </Button>
          <Button icon={<RiseOutlined />} onClick={() => navigate('/dividend-low-vol')}>
            红利低波（{assignments.filter((item) => item.status === 'confirmed' && item.strategyFamily === 'dividend_low_vol').length}）
          </Button>
          <Button icon={<BarChartOutlined />} onClick={() => navigate('/backtest?mode=portfolio')}>
            投资组合（{assignments.filter((item) => item.status === 'confirmed' && item.strategyFamily === 'portfolio').length}）
          </Button>
        </div>
        <div className="mt-2 text-xs text-slate-500">数字来自已确认归类；进入研究页不会创建订单，也不会自动调仓。</div>
      </div>
    </section>
  )
}
