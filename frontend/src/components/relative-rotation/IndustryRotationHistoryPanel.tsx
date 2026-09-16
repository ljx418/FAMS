import { Alert, Card, Col, Row, Statistic, Table, Tag } from 'antd'
import { useMemo } from 'react'
import type { RotationMarket, RotationQuadrant, RotationResearchTimelineItem } from '../../services/relativeRotationService'
import { buildIndustryRotationAnalysis, type IndustryRotationPairAnalysis } from './industryRotationAnalysis'

const quadrantMeta: Record<RotationQuadrant, { label: string; color: string }> = {
  leading: { label: '领先', color: 'green' },
  improving: { label: '改善', color: 'blue' },
  weakening: { label: '弱化', color: 'orange' },
  lagging: { label: '落后', color: 'red' },
}

const percent = (value: number | null, digits = 1) => value === null ? '—' : `${(value * 100).toFixed(digits)}%`
const decimal = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits)

const PairList = ({ title, pairs }: { title: string; pairs: IndustryRotationPairAnalysis[] }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="text-sm font-semibold text-slate-900">{title}</div>
    <div className="mt-3 space-y-2">
      {pairs.length === 0 ? <div className="text-xs text-slate-500">有效共同历史不足</div> : pairs.map((pair) => (
        <div key={pair.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-800">{pair.leftName} / {pair.rightName}</span>
            <Tag color={pair.classification === '同步轮动' ? 'blue' : pair.classification === '阶段分化' ? 'purple' : 'default'}>{pair.classification}</Tag>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            相对收益相关 {decimal(pair.correlation, 3)} · 同象限 {percent(pair.sameQuadrantRatio)} · {pair.alignedPointCount} 个共同节点
          </div>
        </div>
      ))}
    </div>
  </div>
)

export function IndustryRotationHistoryPanel({
  market,
  frequency,
  endDate,
  items,
}: {
  market: RotationMarket
  frequency: 'weekly' | 'daily'
  endDate: string
  items: RotationResearchTimelineItem[]
}) {
  const analysis = useMemo(
    () => buildIndustryRotationAnalysis(items, endDate, frequency),
    [endDate, frequency, items],
  )
  const marketLabel = market === 'CN' ? 'A股' : '港股'
  const current = analysis.currentDistribution
  const prior = analysis.priorDistribution
  const currentSummary = `领先 ${current.leading} · 改善 ${current.improving} · 弱化 ${current.weakening} · 落后 ${current.lagging}`
  const priorSummary = `领先 ${prior.leading} · 改善 ${prior.improving} · 弱化 ${prior.weakening} · 落后 ${prior.lagging}`

  return (
    <Card
      title={`${marketLabel}行业轮动关系（历史）`}
      extra={<span className="text-xs text-slate-500">截止 {analysis.asOfDate || '—'} · {frequency === 'weekly' ? '周频' : '日频'}</span>}
    >
      <Alert
        type="info"
        showIcon
        message={`当前领先象限：${analysis.confirmedLeaders.join('、') || '无'}；当前改善象限：${analysis.improvingCandidates.join('、') || '无'}`}
        description="结论来自同一市场基准下、当前所选区间内的历史相对价格轨迹。领先占比和相关性描述历史状态，不证明因果，也不直接生成买卖单。"
      />

      <Row gutter={[12, 12]} className="mt-4">
        <Col xs={24} sm={12} xl={6}><Statistic title="当前象限分布" value={currentSummary} valueStyle={{ fontSize: 15 }} /></Col>
        <Col xs={24} sm={12} xl={6}><Statistic title={analysis.comparisonLabel} value={priorSummary} valueStyle={{ fontSize: 15 }} /></Col>
        <Col xs={24} sm={12} xl={6}><Statistic title="历史头部最常出现" value={analysis.persistentLeaders.join('、') || '—'} valueStyle={{ fontSize: 15 }} /></Col>
        <Col xs={24} sm={12} xl={6}><Statistic title="有效行业" value={analysis.rows.length} suffix="个" /></Col>
      </Row>

      <Table
        className="mt-4"
        size="small"
        rowKey="targetKey"
        dataSource={analysis.rows}
        pagination={false}
        scroll={{ x: 1120 }}
        columns={[
          {
            title: '行业代理',
            key: 'target',
            width: 190,
            render: (_, row) => <div><div className="font-medium text-slate-900">{row.name}</div><div className="font-mono text-xs text-slate-500">{row.symbol}</div></div>,
          },
          {
            title: '当前轮动状态',
            key: 'role',
            width: 150,
            render: (_, row) => <div><Tag color={quadrantMeta[row.currentQuadrant].color}>{quadrantMeta[row.currentQuadrant].label}</Tag><span className="text-xs text-slate-600">{row.currentRole}</span></div>,
          },
          {
            title: `${analysis.comparisonLabel} → 当前`,
            key: 'transition',
            width: 160,
            render: (_, row) => (
              <div className="whitespace-nowrap text-xs text-slate-600">
                <Tag color={quadrantMeta[row.priorQuadrant].color}>{quadrantMeta[row.priorQuadrant].label}</Tag>
                <span aria-hidden="true">→</span>
                <Tag className="ml-2" color={quadrantMeta[row.currentQuadrant].color}>{quadrantMeta[row.currentQuadrant].label}</Tag>
              </div>
            ),
          },
          { title: '趋势 / 动量', key: 'coordinate', width: 120, align: 'right', render: (_, row) => `${row.currentTrend.toFixed(2)} / ${row.currentMomentum.toFixed(2)}` },
          { title: '区间相对收益', dataIndex: 'relativeReturn', key: 'return', width: 120, align: 'right', render: (value: number | null) => percent(value) },
          { title: '处于领先', dataIndex: 'leadingRatio', key: 'leadingRatio', width: 100, align: 'right', render: (value: number) => percent(value) },
          { title: '领先或改善', dataIndex: 'constructiveRatio', key: 'constructiveRatio', width: 110, align: 'right', render: (value: number) => percent(value) },
          { title: '历史头部占比', dataIndex: 'leaderRatio', key: 'leaderRatio', width: 120, align: 'right', render: (value: number) => percent(value) },
          { title: '当前状态持续', dataIndex: 'currentStreak', key: 'streak', width: 120, align: 'right', render: (value: number) => `${value}${frequency === 'weekly' ? '周' : '日'}` },
        ]}
      />

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <PairList title="相对收益相关最高的组合" pairs={analysis.synchronousPairs} />
        <PairList title="相对收益相关最低的组合" pairs={analysis.differentiatedPairs} />
      </div>
      <p className="mb-0 mt-3 text-xs leading-5 text-slate-500">
        “历史头部”按每个共同日期的相对趋势与相对动量合计排名第一统计；“区间相对收益”是 ETF/基准相对价格的区间变化。相关性基于相对价格的逐期收益，不代表领先—滞后的因果方向。
      </p>
    </Card>
  )
}
