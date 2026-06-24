import React from 'react'
import { Tag } from 'antd'
import type { FivdRCandidateBatchResult } from '../../services/analysisService'
import DataGapPanel from './DataGapPanel'

type Candidate = FivdRCandidateBatchResult['candidates'][number]

const CandidateScoreBreakdown: React.FC<{
  candidate: Candidate
  dispositionLabel: string
  dispositionColor: string
  onSaveSnapshot?: (candidate: Candidate) => void
  onAddWatch?: (candidate: Candidate) => void
  onCreateRiskAlert?: (candidate: Candidate) => void
  actionLoading?: string | null
}> = ({ candidate, dispositionLabel, dispositionColor, onSaveSnapshot, onAddWatch, onCreateRiskAlert, actionLoading }) => {
  const signalScore = candidate.signalScore ?? candidate.dimensions.strategy ?? candidate.dimensions.strategyValidation ?? candidate.totalScore
  const researchScore = candidate.researchScore ?? candidate.totalScore
  const evidenceAdjustedScore = candidate.evidenceAdjustedScore ?? candidate.totalScore
  const hasIdentityGap = candidate.blockers.includes('asset_identity_missing')
  const tradeBlocked = candidate.prohibitedActions.some((action) => ['ADD', 'REDUCE', 'AUTO_TRADE'].includes(action))
  const adjustmentReasons = [
    hasIdentityGap ? '资产身份未完整确认' : null,
    candidate.blockers.includes('validation_evidence') ? 'validation evidence 未通过' : null,
    candidate.dataGapSummary?.some((gap) => gap.severity === 'blocking') ? '存在 blocking 数据缺口' : null,
    evidenceAdjustedScore < researchScore ? `证据折扣 ${researchScore} -> ${evidenceAdjustedScore}` : null,
  ].filter(Boolean) as string[]
  const watchLoading = actionLoading === `candidate-watch-${candidate.symbol}`
  const riskLoading = actionLoading === `candidate-risk-${candidate.symbol}`
  const snapshotLoading = actionLoading === `candidate-snapshot-${candidate.symbol}`

  return (
    <div className="rounded border border-white/10 bg-black/10 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-white">#{candidate.rank} {candidate.name}</span>
          <span className="ml-2 text-xs text-gray-400">{candidate.symbol}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Tag color="#38bdf8">证据调整 {evidenceAdjustedScore}</Tag>
          <Tag color={dispositionColor}>{dispositionLabel}</Tag>
          {candidate.capabilityState && <Tag color="#fbbf24">{candidate.capabilityState}</Tag>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs text-gray-300 md:grid-cols-6">
        <div>策略 {signalScore}</div>
        <div>研究 {researchScore}</div>
        <div>调整 {evidenceAdjustedScore}</div>
        <div>估值 {candidate.dimensions.valuation}</div>
        <div>收益 {candidate.dimensions.expectedReturn}</div>
        <div>证据 {candidate.dimensions.evidenceQuality}</div>
      </div>
      {adjustmentReasons.length > 0 && (
        <div className="mt-2 rounded border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-xs leading-5 text-sky-100">
          折扣原因：{adjustmentReasons.join('；')}
        </div>
      )}
      {hasIdentityGap && (
        <div className="mt-2 rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-xs text-amber-100">
          策略信号存在，但资产身份尚未完整确认，当前只能作为研究线索。
        </div>
      )}
      {tradeBlocked && (
        <div className="mt-2 rounded border border-red-400/20 bg-red-400/10 px-2 py-1 text-xs text-red-100">
          ADD / REDUCE / AUTO_TRADE 均被禁止，不能转换为交易动作。
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="mr-1 text-xs text-gray-400">可做</span>
        {candidate.allowedActions.map((action) => (
          <Tag key={action} color="#34d399" style={{ marginRight: 0 }}>{action}</Tag>
        ))}
        <span className="mx-1 text-xs text-gray-400">禁止</span>
        {candidate.prohibitedActions.map((action) => (
          <Tag key={action} color="#f87171" style={{ marginRight: 0 }}>{action}</Tag>
        ))}
      </div>
      <div className="mt-2 text-xs leading-5 text-gray-300">{candidate.rationale.slice(0, 2).join('；')}</div>
      {candidate.blockers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidate.blockers.slice(0, 4).map((blocker) => (
            <Tag key={blocker} color="#f87171" style={{ marginRight: 0 }}>{blocker}</Tag>
          ))}
        </div>
      )}
      <div className="mt-2">
        <DataGapPanel gaps={candidate.dataGapSummary} compact limit={2} title="候选数据缺口" />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-400/30 px-2 py-1 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!onSaveSnapshot || snapshotLoading}
          onClick={() => onSaveSnapshot?.(candidate)}
        >
          {snapshotLoading ? '保存中...' : '保存快照'}
        </button>
        <button
          type="button"
          className="rounded border border-sky-400/30 px-2 py-1 text-xs text-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!onAddWatch || watchLoading}
          onClick={() => onAddWatch?.(candidate)}
        >
          {watchLoading ? '加入中...' : '加入观察'}
        </button>
        <button
          type="button"
          className="rounded border border-amber-400/30 px-2 py-1 text-xs text-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!onCreateRiskAlert || riskLoading}
          onClick={() => onCreateRiskAlert?.(candidate)}
        >
          {riskLoading ? '创建中...' : '风险提醒'}
        </button>
      </div>
    </div>
  )
}

export default CandidateScoreBreakdown
