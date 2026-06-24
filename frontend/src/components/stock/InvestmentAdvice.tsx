import React from 'react'
import { Card, Tag, Progress, Row, Col } from 'antd'

interface Signal {
  type: 'positive' | 'negative' | 'neutral'
  indicator: string
  description: string
  strength: number // 0-100
}

interface InvestmentAdviceProps {
  symbol?: string
  advice?: {
    overall: '偏强' | '偏弱' | '中性' | '数据不足'
    score: number // 0-100
    signals: Signal[]
    summary: string
    riskLevel: '低' | '中' | '高'
    resistance?: number
    support?: number
  }
}

const defaultAdvice = {
  overall: '数据不足' as const,
  score: 65,
  riskLevel: '中' as const,
  summary: '当前仅展示技术事实观察，不构成买卖、加仓、减仓或仓位建议。',
  resistance: 165.0,
  support: 138.0,
  signals: [
    { type: 'positive', indicator: 'RSI', description: 'RSI 指标偏强', strength: 72 },
    { type: 'positive', indicator: 'MACD', description: 'MACD 动能偏正', strength: 68 },
    { type: 'neutral', indicator: 'KDJ', description: 'KDJ 处于中性区间', strength: 55 },
    { type: 'negative', indicator: 'BOLL', description: '价格接近波动区间上沿', strength: 45 },
    { type: 'neutral', indicator: 'MA', description: '均线结构待确认', strength: 60 },
  ] as Signal[],
}

const InvestmentAdvice: React.FC<InvestmentAdviceProps> = ({ advice }) => {
  const data = advice || defaultAdvice

  const getAdviceColor = (overall: string) => {
    switch (overall) {
      case '偏强':
        return 'success'
      case '偏弱':
        return 'danger'
      default:
        return '#FAC858'
    }
  }

  const getAdviceBgColor = (overall: string) => {
    switch (overall) {
      case '偏强':
        return 'rgba(115, 216, 151, 0.1)'
      case '偏弱':
        return 'rgba(238, 102, 102, 0.1)'
      default:
        return 'rgba(250, 200, 88, 0.1)'
    }
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case '低':
        return 'success'
      case '高':
        return 'danger'
      default:
        return '#FAC858'
    }
  }

  const getSignalColor = (type: string) => {
    switch (type) {
      case 'positive':
        return 'success'
      case 'negative':
        return 'danger'
      default:
        return '#FAC858'
    }
  }

  const getSignalTagColor = (type: string) => {
    switch (type) {
      case 'positive':
        return 'green'
      case 'negative':
        return 'red'
      default:
        return 'gold'
    }
  }

  return (
    <Card
      title={<span className="text-white text-sm">技术事实观察</span>}
      className="bg-[#1a1a2e] border-[surface-border]"
      size="small"
    >
      {/* 整体观察 */}
      <div
        className="p-4 rounded mb-4"
        style={{
          backgroundColor: getAdviceBgColor(data.overall),
          borderLeft: `4px solid ${getAdviceColor(data.overall)}`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-gray-300 text-sm">综合观察</span>
            <Tag color={getAdviceColor(data.overall)} className="text-sm font-medium">
              {data.overall}
            </Tag>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-300 text-xs">风险等级</span>
            <span
              className="text-sm font-medium px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${getRiskColor(data.riskLevel)}20`,
                color: getRiskColor(data.riskLevel),
              }}
            >
              {data.riskLevel}
            </span>
          </div>
        </div>

        {/* 评分进度条 */}
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-300">综合评分</span>
            <span style={{ color: getAdviceColor(data.overall) }}>{data.score}分</span>
          </div>
          <Progress
            percent={data.score}
            showInfo={false}
            strokeColor={getAdviceColor(data.overall)}
            trailColor="surface-border"
            size="small"
          />
        </div>

        {/* 支撑阻力观察 */}
        <Row gutter={16} className="mb-3">
          <Col span={12}>
            <div className="text-xs text-gray-300">阻力观察</div>
            <div className="text-lg font-medium text-[success]">
              ¥{data.resistance?.toFixed(2) || '--'}
            </div>
          </Col>
          <Col span={12}>
            <div className="text-xs text-gray-300">支撑观察</div>
            <div className="text-lg font-medium text-[danger]">
              ¥{data.support?.toFixed(2) || '--'}
            </div>
          </Col>
        </Row>

        {/* 总结 */}
        <p className="text-gray-300 text-sm m-0">{data.summary}</p>
      </div>

      {/* 信号列表 */}
      <div>
        <div className="text-gray-300 text-xs mb-2">技术信号</div>
        <div className="space-y-2">
          {data.signals.map((signal, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-2 bg-[#0f0f23] rounded"
            >
              <div className="flex items-center gap-2">
                <Tag color={getSignalTagColor(signal.type)} className="text-xs">
                  {signal.type === 'positive' ? '偏强' : signal.type === 'negative' ? '偏弱' : '中性'}
                </Tag>
                <span className="text-white text-sm">{signal.indicator}</span>
                <span className="text-gray-500 text-xs">{signal.description}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-300 text-xs">强度</span>
                <Progress
                  percent={signal.strength}
                  showInfo={false}
                  strokeColor={getSignalColor(signal.type)}
                  trailColor="surface-border"
                  size="small"
                  className="w-16"
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: getSignalColor(signal.type), width: '28px', textAlign: 'right' }}
                >
                  {signal.strength}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default InvestmentAdvice
