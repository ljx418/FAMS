import React from 'react'
import { Alert, Tag } from 'antd'
import type { DataGap, FivdRCapabilityState } from '../../services/analysisService'

const STATE_COLOR: Record<FivdRCapabilityState, string> = {
  RESEARCH_READY: '#34d399',
  OBSERVE_ONLY: '#fbbf24',
  DATA_INSUFFICIENT: '#f59e0b',
  TRADE_BLOCKED: '#f87171',
  SYSTEM_UNAVAILABLE: '#94a3b8',
}

const STATE_LABEL: Record<FivdRCapabilityState, string> = {
  RESEARCH_READY: '研究可用',
  OBSERVE_ONLY: '仅可观察',
  DATA_INSUFFICIENT: '数据不足',
  TRADE_BLOCKED: '交易阻断',
  SYSTEM_UNAVAILABLE: '系统不可用',
}

const FivdRStatusBanner: React.FC<{
  capabilityState?: FivdRCapabilityState
  blockedReasons?: string[]
  dataGapSummary?: DataGap[]
  formalTradeActionAllowed?: boolean
  autoTradeAllowed?: boolean
}> = ({
  capabilityState = 'TRADE_BLOCKED',
  blockedReasons = [],
  dataGapSummary = [],
  formalTradeActionAllowed = false,
  autoTradeAllowed = false,
}) => {
  const validationBlocked = blockedReasons.includes('validation_evidence')
    || dataGapSummary.some((gap) => gap.category === 'validation_evidence')
    || formalTradeActionAllowed === false
  const firstGap = dataGapSummary[0]
  const description = (
    <div className="space-y-2 text-xs leading-5">
      <div>
        当前是否允许 formal ADD/REDUCE：{formalTradeActionAllowed ? '是' : '否'}；AUTO_TRADE：{autoTradeAllowed ? '是' : '否'}。
      </div>
      {validationBlocked && (
        <div>原因：validation_evidence 未通过。本页面不得作为买入、加仓、减仓或自动交易指令。</div>
      )}
      {firstGap && <div>下一步：{firstGap.suggestedAction}</div>}
      {blockedReasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {blockedReasons.slice(0, 6).map((reason) => (
            <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <Alert
      type={capabilityState === 'RESEARCH_READY' ? 'info' : capabilityState === 'TRADE_BLOCKED' ? 'error' : 'warning'}
      showIcon
      message={
        <span>
          当前为研究/观察模式，交易动作未放行。
          <Tag color={STATE_COLOR[capabilityState]} className="ml-2">{STATE_LABEL[capabilityState]}</Tag>
        </span>
      }
      description={description}
    />
  )
}

export default FivdRStatusBanner
