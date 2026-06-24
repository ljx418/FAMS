import React from 'react'
import { Empty, Tag } from 'antd'
import type { DataGap } from '../../services/analysisService'

const SEVERITY_COLOR: Record<DataGap['severity'], string> = {
  blocking: '#f87171',
  degrading: '#fbbf24',
  optional: '#94a3b8',
}

const REQUIRED_FOR_LABEL: Record<string, string> = {
  research: '研究',
  observe: '观察',
  manual_trade_draft: '人工草案',
  formal_trade_action: '正式交易',
}

const DataGapPanel: React.FC<{
  gaps?: DataGap[]
  title?: string
  compact?: boolean
  limit?: number
}> = ({ gaps = [], title = 'Data Gap Summary', compact = false, limit }) => {
  const visible = typeof limit === 'number' ? gaps.slice(0, limit) : gaps

  if (visible.length === 0) {
    return compact ? null : (
      <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-gray-300">暂无结构化数据缺口</span>} />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-amber-100">{title}</div>
        <Tag color="#fbbf24" style={{ marginRight: 0 }}>缺口 {gaps.length}</Tag>
      </div>
      <div className="space-y-2">
        {visible.map((gap) => (
          <div key={gap.gapId} className="rounded-lg border border-white/10 bg-black/10 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <Tag color={SEVERITY_COLOR[gap.severity]} style={{ marginRight: 0 }}>{gap.severity}</Tag>
              <Tag color="#38bdf8" style={{ marginRight: 0 }}>{gap.category}</Tag>
              <Tag color="#818cf8" style={{ marginRight: 0 }}>{gap.assetType}</Tag>
              {gap.symbol && <Tag color="#64748b" style={{ marginRight: 0 }}>{gap.symbol}</Tag>}
            </div>
            <div className="text-xs leading-5 text-gray-200">{gap.userMessage || gap.blockedReason}</div>
            {!compact && (
              <>
                <div className="mt-2 flex flex-wrap gap-1">
                  {gap.requiredFor.map((item) => (
                    <Tag key={item} color={item.includes('trade') ? '#f87171' : '#fbbf24'} style={{ marginRight: 0 }}>
                      {REQUIRED_FOR_LABEL[item] || item}
                    </Tag>
                  ))}
                </div>
                <div className="mt-2 text-xs leading-5 text-gray-300">
                  缺失字段：{gap.missingFields.length > 0 ? gap.missingFields.slice(0, 8).join(' / ') : '未列明'}
                </div>
                <div className="mt-1 text-xs leading-5 text-amber-100">下一步：{gap.suggestedAction}</div>
                {gap.evidenceRefs.length > 0 && (
                  <div className="mt-1 text-[11px] leading-5 text-gray-400">
                    evidenceRefs：{gap.evidenceRefs.slice(0, 3).join(' / ')}
                  </div>
                )}
                {gap.lastError && <div className="mt-1 text-[11px] text-red-200">{gap.lastError}</div>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default DataGapPanel
