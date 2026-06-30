import { Alert, Button, Card, Space, Tag } from 'antd'
import { EyeOutlined, FileSearchOutlined, ReloadOutlined } from '@ant-design/icons'

type CandidateLike = {
  identity: { symbol: string; name?: string; industry?: string }
  disposition: string
  candidateGrade?: string
  blockedReasons?: string[]
  dataGapSummary?: unknown[]
  alerts?: Array<{ type: string; triggerReason?: string }>
  dataTrust?: { grade?: string; displayLabel?: string; confidencePercent?: number }
  scores: {
    evidenceAdjustedScore: number
    dividendScore?: number
    dividendQualityScore?: number
    lowVolScore?: number
  }
  timing: { lowZoneScore?: number; highZoneScore?: number }
  dividend: { ttmDividendYield?: number; dividendTrapFlag?: boolean }
}

type DividendLowVolDecisionCardProps = {
  candidates: CandidateLike[]
  totalCandidates: number
  completeCount: number
  formalTradingUnlocked: boolean
  onViewZones: () => void
  onCreateDraft: () => void
  onRefresh: () => void
  loadingZones?: boolean
  loadingDraft?: boolean
  loadingRefresh?: boolean
}

const formatScore = (value?: number) => Number.isFinite(value) ? Number(value).toFixed(1) : '--'

const dispositionText = (candidate: CandidateLike) => {
  if (candidate.disposition === 'avoid' || candidate.dividend.dividendTrapFlag) return '风险剔除'
  if (candidate.disposition === 'data_insufficient' || (candidate.dataGapSummary || []).length > 0) return '数据不足'
  if (candidate.alerts?.some((alert) => alert.type === 'DIVIDEND_BUILD_PLAN')) return '可生成观察草案'
  if (candidate.alerts?.some((alert) => alert.type === 'DIVIDEND_LOW_ZONE')) return '低位观察'
  return '可研究观察'
}

const plainReasons = (candidate: CandidateLike) => {
  const reasons: string[] = []
  if ((candidate.dividend.ttmDividendYield || 0) >= 4) reasons.push(`股息率 ${formatScore(candidate.dividend.ttmDividendYield)}%，满足高分红研究门槛`)
  if ((candidate.scores.dividendQualityScore || 0) >= 65) reasons.push('分红质量分较高，暂未触发明显高息陷阱')
  if ((candidate.scores.lowVolScore || 0) >= 60) reasons.push('低波动分达标，适合防守型观察')
  if ((candidate.timing.lowZoneScore || 0) >= 65) reasons.push('低位分较高，可进入观察区间复核')
  if (candidate.blockedReasons?.length) reasons.push(`仍有阻断：${candidate.blockedReasons.slice(0, 2).join('、')}`)
  if ((candidate.dataGapSummary || []).length > 0) reasons.push('存在数据缺口，需要刷新或查看专业证据')
  return reasons.slice(0, 3)
}

export function DividendLowVolDecisionCard({
  candidates,
  totalCandidates,
  completeCount,
  formalTradingUnlocked,
  onViewZones,
  onCreateDraft,
  onRefresh,
  loadingZones,
  loadingDraft,
  loadingRefresh,
}: DividendLowVolDecisionCardProps) {
  return (
    <Card
      title={<span className="text-primary">普通模式：先看结论和下一步</span>}
      className="bg-[#1a1a2e] border-surface-border"
      styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}
    >
      <Alert
        className="mb-4"
        type={formalTradingUnlocked ? 'warning' : 'info'}
        showIcon
        message={formalTradingUnlocked ? '正式交易仍需人工最终确认' : '当前只能研究、观察和生成草案'}
        description="这些结论用于帮你判断是否继续研究。系统不会创建订单，也不会输出正式买入、卖出或自动交易动作。"
      />
      <div className="grid gap-3 xl:grid-cols-[1fr_2fr]">
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="text-sm font-medium text-white">当前样本状态</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border border-white/10 bg-[#0f172a] p-2">
              <div className="text-gray-400">候选总数</div>
              <div className="text-xl font-semibold text-white">{totalCandidates}</div>
            </div>
            <div className="rounded border border-white/10 bg-[#0f172a] p-2">
              <div className="text-gray-400">指标完整</div>
              <div className="text-xl font-semibold text-white">{completeCount}</div>
            </div>
          </div>
          <div className="mt-3 text-xs leading-5 text-gray-400">
            如果指标完整数低，先刷新候选或查看专业模式中的数据缺口。普通模式不会隐藏阻断原因。
          </div>
          <Space className="mt-4" wrap>
            <Button size="small" icon={<ReloadOutlined />} loading={loadingRefresh} onClick={onRefresh}>刷新数据</Button>
            <Button size="small" icon={<EyeOutlined />} loading={loadingZones} onClick={onViewZones}>查看区间</Button>
            <Button size="small" type="primary" icon={<FileSearchOutlined />} loading={loadingDraft} onClick={onCreateDraft}>生成草案</Button>
          </Space>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {candidates.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-sm text-gray-400 lg:col-span-3">
              当前筛选下暂无完整候选。请放宽筛选条件或刷新数据。
            </div>
          ) : candidates.map((candidate, index) => (
            <div key={candidate.identity.symbol} className="rounded-lg border border-white/10 bg-[#0f172a] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{index + 1}. {candidate.identity.symbol} {candidate.identity.name}</div>
                  <div className="mt-1 truncate text-xs text-gray-500">{candidate.identity.industry || '行业待确认'}</div>
                </div>
                <Tag color={candidate.disposition === 'avoid' ? '#ef4444' : '#38bdf8'}>{dispositionText(candidate)}</Tag>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Tag color="#38bdf8">综合 {formatScore(candidate.scores.evidenceAdjustedScore)}</Tag>
                <Tag color="#34d399">股息 {formatScore(candidate.dividend.ttmDividendYield)}%</Tag>
                <Tag color={candidate.dataTrust?.grade === 'INSUFFICIENT' ? '#ef4444' : '#fbbf24'}>{candidate.dataTrust?.grade || '证据待查'}</Tag>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-5 text-gray-300">
                {plainReasons(candidate).map((reason) => (
                  <div key={reason}>- {reason}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
