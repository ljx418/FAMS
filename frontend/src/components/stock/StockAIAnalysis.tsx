import React, { useState } from 'react'
import { Card, Input, Button, Tag, Spin, Alert } from 'antd'
import { RobotOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { getLLMStockAdvice, type LLMStockAdvice } from '../../services/stockService'

interface StockAIAnalysisProps {
  defaultCode?: string
}

const StockAIAnalysis: React.FC<StockAIAnalysisProps> = ({ defaultCode = '601888' }) => {
  const [code, setCode] = useState(defaultCode)
  const [loading, setLoading] = useState(false)
  const [advice, setAdvice] = useState<LLMStockAdvice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await getLLMStockAdvice(code.trim(), 'A股')
      setAdvice(result)
    } catch (err: any) {
      setError(err.message || 'AI 分析失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case '高': return 'success'
      case '中': return '#fbbf24'
      case '低': return '#f87171'
      default: return '#9ca3af'
    }
  }

  const getReferencedEvidence = (result: LLMStockAdvice) => {
    const refs = new Set([
      ...result.evidenceRefs,
      ...result.reasoning.flatMap((item) => item.evidenceRefs),
    ])
    return result.evidence.filter((item) => refs.has(item.id))
  }

  const providerLabel = advice
    ? advice.isAiGenerated
      ? advice.provider === 'minimax' ? 'MiniMax AI' : 'DeepSeek AI'
      : '本地规则兜底'
    : 'AI'

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <RobotOutlined className="text-lg" style={{ color: '#818cf8' }} />
          <span className="text-white">AI 股票分析</span>
        </div>
      }
      className="bg-[#1a1a2e] border-[surface-border]"
      extra={
        <Tag color={loading ? 'processing' : advice?.isAiGenerated ? 'success' : 'warning'}>
          {loading ? '分析中...' : providerLabel}
        </Tag>
      }
    >
      {/* 搜索框 */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="输入股票代码，如 601888"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={handleAnalyze}
          className="flex-1 bg-[#0f0f23] border-[surface-border] text-white"
          style={{ color: '#fff' }}
        />
        <Button
          type="primary"
          icon={<SearchOutlined />}
          onClick={handleAnalyze}
          loading={loading}
          style={{ backgroundColor: '#818cf8', borderColor: '#818cf8' }}
        >
          分析
        </Button>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex justify-center py-8">
          <Spin tip="AI 分析中，请稍候..." />
        </div>
      )}

      {/* 错误提示 */}
      {error && !loading && (
        <Alert type="error" message={error} className="mb-4" />
      )}

      {/* AI 分析结果 */}
      {advice && !loading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
            <Tag color="#38bdf8">{advice.symbol}</Tag>
            <span className="text-white font-medium">{advice.name}</span>
            <Tag color={advice.isAiGenerated ? 'success' : 'warning'}>
              {providerLabel}
            </Tag>
            {!advice.isAiGenerated && (
              <span className="text-yellow-300">LLM 不可用，当前为本地技术规则兜底。</span>
            )}
          </div>

          {/* 观察 */}
          <div
            className="p-4 rounded-lg"
            style={{ backgroundColor: 'rgba(129, 140, 248, 0.1)' }}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="text-gray-300 text-xs">事实观察</div>
              <Tag color={advice.status === 'available' ? '#38bdf8' : '#fbbf24'}>
                {advice.status === 'available' ? '有证据引用' : '数据不足'}
              </Tag>
              <Tag color={getConfidenceColor(advice.confidence)}>
                证据强度 {advice.confidence}
              </Tag>
            </div>
            <div className="text-white text-lg font-semibold">
              {advice.status === 'available' ? advice.observation : '数据不足，仅能作为观察'}
            </div>
            <div className="text-gray-300 text-sm mt-2">
              {advice.summary || '缺少可追溯证据引用，暂不展示结论性解释。'}
            </div>
          </div>

          {/* 引用证据 */}
          <div>
            <div className="text-gray-300 text-xs mb-2">引用证据</div>
            {getReferencedEvidence(advice).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {getReferencedEvidence(advice).map((item) => (
                  <div key={item.id} className="p-3 rounded border border-[surface-border] bg-[#0f0f23]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm font-medium">{item.label}</span>
                      <Tag color="#475569" style={{ marginRight: 0 }}>{item.id}</Tag>
                    </div>
                    <div className="text-gray-300 text-sm mt-1">{item.value}</div>
                    <div className="text-gray-500 text-xs mt-1">{item.source}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-yellow-300 text-sm">缺少 evidenceRefs，当前结果仅能作为观察。</div>
            )}
          </div>

          {/* 解释 */}
          <div>
            <div className="text-gray-300 text-xs mb-2 flex items-center gap-1">
              <ThunderboltOutlined />
              AI 解释
            </div>
            <div className="space-y-1">
              {advice.reasoning.map((reason, index) => (
                <div key={`${reason.title}-${index}`} className="flex items-start gap-2 text-sm">
                  <span className="text-[#818cf8] shrink-0">•</span>
                  <span className="text-gray-300">
                    <span className="text-white">{reason.title}：</span>{reason.detail}
                  </span>
                </div>
              ))}
              {advice.reasoning.length === 0 && (
                <div className="text-gray-400 text-sm">暂无可追溯解释。</div>
              )}
            </div>
          </div>

          {advice.dataGaps.length > 0 && (
            <div>
              <div className="text-gray-300 text-xs mb-2">数据缺口</div>
              <div className="flex flex-wrap gap-2">
                {advice.dataGaps.map((gap) => (
                  <Tag key={gap} color="#475569">{gap}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* 风险提示 */}
          {advice.riskWarning && (
            <div
              className="p-3 rounded text-sm"
              style={{ backgroundColor: 'rgba(251, 191, 36, 0.1)' }}
            >
              <span className="text-yellow-400 font-medium">⚠️ 风险提示：</span>
              <span className="text-gray-300">{advice.riskWarning}</span>
            </div>
          )}

          {/* 免责声明 */}
          <div className="text-gray-600 text-xs pt-2 border-t border-[surface-border]">
            {advice.disclaimer}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!advice && !loading && !error && (
        <div className="text-center py-8 text-gray-500 text-sm">
          输入股票代码，点击「分析」获取 AI 事实观察
        </div>
      )}
    </Card>
  )
}

export default StockAIAnalysis
