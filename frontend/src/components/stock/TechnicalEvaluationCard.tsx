import React, { useMemo } from 'react'
import { Card, Tag } from 'antd'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts } from '../../styles/chartTheme'
import type { StockAnalysisResponse } from '../../services/stockService'

interface TechnicalEvaluationCardProps {
  analysis: StockAnalysisResponse
}

// 雷达图指标配置: 趋势(30)、动量(25)、波动(20)、成交量(15)、支撑阻力(10)
const RADAR_INDICATORS = [
  { name: '趋势', max: 30 },
  { name: '动量', max: 25 },
  { name: '波动', max: 20 },
  { name: '成交量', max: 15 },
  { name: '支撑阻力', max: 10 },
]

// 计算各维度得分
function calculateScores(analysis: StockAnalysisResponse) {
  // 趋势得分 (0-30): 基于MA排列和价格位置
  let trendScore = 0
  if (analysis.ma5 && analysis.ma10 && analysis.ma20) {
    const { ma5, ma10, ma20, current_price } = analysis
    // 均线多头排列 (ma5 > ma10 > ma20) 得分高
    if (ma5 > ma10 && ma10 > ma20) {
      trendScore += 15
    }
    // 价格在均线上方
    if (current_price > ma5) {
      trendScore += 10
    }
    // 短期均线在长期均线上方金叉预期
    if (ma5 > ma10 * 0.98) {
      trendScore += 5
    }
  }

  // 动量得分 (0-25): 基于RSI和MACD
  let momentumScore = 0
  const rsi = analysis.rsi || 50
  if (rsi >= 50) {
    momentumScore += 10 // RSI在强势区域
  }
  if (rsi >= 60 && rsi < 80) {
    momentumScore += 5 // 强势但未超买
  } else if (rsi >= 80) {
    momentumScore -= 5 // 超买
  }

  // MACD
  if (analysis.macd_histogram !== undefined) {
    if (analysis.macd_histogram > 0) {
      momentumScore += 5 // MACD红柱
    }
    if (analysis.macd_dif !== undefined && analysis.macd_dea !== undefined) {
      if (analysis.macd_dif > analysis.macd_dea) {
        momentumScore += 5 // DIF在DEA上方
      }
    }
  }

  // 波动得分 (0-20): 基于波动率和ATR
  let volatilityScore = 10 // 基础分
  const volatility = analysis.volatility || 0.02
  if (volatility < 0.015) {
    volatilityScore += 5 // 低波动，稳定
  } else if (volatility > 0.04) {
    volatilityScore -= 5 // 高波动，风险大
  }

  // KDJ
  if (analysis.kdj_k !== undefined && analysis.kdj_d !== undefined) {
    if (analysis.kdj_k > analysis.kdj_d && analysis.kdj_k < 80) {
      volatilityScore += 3 // 金叉且未超买
    }
  }

  // 成交量得分 (0-15): 基于量价配合
  let volumeScore = 7.5 // 基础分
  const priceChangePercent = analysis.price_change_percent || 0
  if (priceChangePercent > 0) {
    volumeScore += 4 // 上涨有量
    if (analysis.volume > analysis.turnover / analysis.current_price / 2) {
      volumeScore += 3.5 // 放量确认
    }
  } else if (priceChangePercent < 0) {
    volumeScore += 2 // 下跌无量可能是洗盘
  }

  // 支撑阻力得分 (0-10)
  let supportResistanceScore = 5 // 基础分
  const { current_price, support, resistance } = analysis
  if (support && resistance) {
    const range = resistance - support
    const priceInRange = current_price - support
    const positionRatio = range > 0 ? priceInRange / range : 0.5
    // 价格在支撑上方且靠近阻力
    if (positionRatio > 0.3 && positionRatio < 0.8) {
      supportResistanceScore += 5
    }
  }

  return [
    Math.min(trendScore, 30),
    Math.min(momentumScore, 25),
    Math.min(volatilityScore, 20),
    Math.min(volumeScore, 15),
    Math.min(supportResistanceScore, 10),
  ]
}

// 获取评级
function getRating(totalScore: number): { label: string; color: string } {
  if (totalScore >= 80) return { label: '优秀', color: '#34d399' }
  if (totalScore >= 60) return { label: '良好', color: '#60a5fa' }
  if (totalScore >= 40) return { label: '一般', color: '#fbbf24' }
  return { label: '较差', color: '#f87171' }
}

// 生成简明评价
function generateSummary(analysis: StockAnalysisResponse): string {
  const { rsi, macd_histogram, ma5, ma10, current_price } = analysis
  const parts: string[] = []

  if (rsi !== undefined) {
    if (rsi >= 80) {
      parts.push('RSI处于超买区域，建议等待回调后再入场')
    } else if (rsi >= 70) {
      parts.push('RSI偏高，注意短期回调风险')
    } else if (rsi <= 20) {
      parts.push('RSI处于超卖区域，可能存在反弹机会')
    } else if (rsi <= 30) {
      parts.push('RSI偏低，适度关注低吸机会')
    } else {
      parts.push('RSI处于正常区间')
    }
  }

  if (macd_histogram !== undefined && macd_histogram > 0) {
    parts.push('MACD红柱扩张，动能较强')
  } else if (macd_histogram !== undefined && macd_histogram < 0) {
    parts.push('MACD绿柱，动能偏弱')
  }

  if (ma5 !== undefined && ma10 !== undefined) {
    if (ma5 > ma10) {
      parts.push('短期均线多头排列')
    } else if (ma5 < ma10) {
      parts.push('短期均线空头排列')
    }
  }

  if (current_price > (ma5 || 0) && current_price > (ma10 || 0)) {
    parts.push('价格运行于短期均线上方')
  }

  return parts.slice(0, 2).join('，') || '暂无明确信号'
}

// 检测技术信号
function detectSignals(analysis: StockAnalysisResponse): Array<{ label: string; color: string; type: string }> {
  const signals: Array<{ label: string; color: string; type: string }> = []

  // MACD金叉/死叉
  if (analysis.macd_dif !== undefined && analysis.macd_dea !== undefined) {
    if (analysis.macd_dif > analysis.macd_dea && analysis.macd_histogram && analysis.macd_histogram > 0) {
      signals.push({ label: 'MACD金叉', color: '#34d399', type: 'buy' })
    } else if (analysis.macd_dif < analysis.macd_dea) {
      signals.push({ label: 'MACD死叉', color: '#f87171', type: 'sell' })
    }
  }

  // RSI超买/超卖
  if (analysis.rsi !== undefined) {
    if (analysis.rsi >= 80) {
      signals.push({ label: 'RSI超买', color: '#f87171', type: 'sell' })
    } else if (analysis.rsi <= 20) {
      signals.push({ label: 'RSI超卖', color: '#34d399', type: 'buy' })
    } else if (analysis.rsi >= 70) {
      signals.push({ label: 'RSI强势', color: '#fbbf24', type: 'hold' })
    }
  }

  // 均线多头/空头排列
  if (analysis.ma5 !== undefined && analysis.ma10 !== undefined && analysis.ma20 !== undefined) {
    if (analysis.ma5 > analysis.ma10 && analysis.ma10 > analysis.ma20) {
      signals.push({ label: '均线多头排列', color: '#34d399', type: 'buy' })
    } else if (analysis.ma5 < analysis.ma10 && analysis.ma10 < analysis.ma20) {
      signals.push({ label: '均线空头排列', color: '#f87171', type: 'sell' })
    }
  }

  // KDJ金叉/死叉
  if (analysis.kdj_k !== undefined && analysis.kdj_d !== undefined) {
    if (analysis.kdj_k > analysis.kdj_d) {
      signals.push({ label: 'KDJ金叉', color: '#34d399', type: 'buy' })
    } else {
      signals.push({ label: 'KDJ死叉', color: '#f87171', type: 'sell' })
    }
  }

  // 布林带突破
  if (analysis.boll_upper !== undefined && analysis.current_price !== undefined) {
    if (analysis.current_price > analysis.boll_upper) {
      signals.push({ label: '突破布林上轨', color: '#f87171', type: 'sell' })
    } else if (analysis.boll_lower !== undefined && analysis.current_price < analysis.boll_lower) {
      signals.push({ label: '跌破布林下轨', color: '#34d399', type: 'buy' })
    }
  }

  // 趋势判断
  if (analysis.trend === '上涨') {
    signals.push({ label: '趋势上涨', color: '#34d399', type: 'buy' })
  } else if (analysis.trend === '下跌') {
    signals.push({ label: '趋势下跌', color: '#f87171', type: 'sell' })
  }

  return signals.slice(0, 6) // 最多显示6个信号
}

const TechnicalEvaluationCard: React.FC<TechnicalEvaluationCardProps> = ({ analysis }) => {
  const scores = useMemo(() => calculateScores(analysis), [analysis])
  const totalScore = useMemo(() => scores.reduce((a, b) => a + b, 0), [scores])
  const rating = useMemo(() => getRating(totalScore), [totalScore])
  const summary = useMemo(() => generateSummary(analysis), [analysis])
  const signals = useMemo(() => detectSignals(analysis), [analysis])

  const radarOption: EChartsOption = useMemo(() => ({
    backgroundColor: 'transparent',
    animation: true,
    radar: {
      indicator: RADAR_INDICATORS,
      shape: 'polygon',
      splitNumber: 4,
      axisName: {
        color: colors.textSecondary,
        fontSize: fonts.size.sm,
        fontFamily: fonts.family,
      },
      splitLine: {
        lineStyle: {
          color: colors.gridLight,
        },
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ['rgba(129, 140, 248, 0.05)', 'rgba(129, 140, 248, 0.1)', 'rgba(129, 140, 248, 0.15)', 'rgba(129, 140, 248, 0.2)'],
        },
      },
      axisLine: {
        lineStyle: {
          color: colors.grid,
        },
      },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: scores,
            name: '技术评分',
            lineStyle: {
              color: colors.primary,
              width: 2,
            },
            areaStyle: {
              color: 'rgba(129, 140, 248, 0.3)',
            },
            itemStyle: {
              color: colors.primary,
            },
          },
        ],
      },
    ],
  }), [scores])

  return (
    <Card className="bg-[#0f0f23] border-[surface-border] card-md">
      <div className="flex items-start gap-4">
        {/* 左侧: 雷达图 */}
        <div className="flex-shrink-0" style={{ width: 200, height: 180 }}>
          <ReactECharts
            option={radarOption}
            style={{ width: '100%', height: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* 右侧: 评分和信号 */}
        <div className="flex-1 min-w-0">
          {/* 综合评分 */}
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-4xl font-bold" style={{ color: rating.color }}>
              {Math.round(totalScore)}
            </span>
            <span className="text-lg font-medium" style={{ color: rating.color }}>
              {rating.label}
            </span>
            <span className="text-gray-300 text-sm">/ 100分</span>
          </div>

          {/* 简明评价 */}
          <p className="text-sm text-gray-300 mb-3">{summary}</p>

          {/* 技术信号标签 */}
          <div className="flex flex-wrap gap-2">
            {signals.map((signal) => (
              <Tag
                key={signal.label}
                color={signal.color}
                className="text-xs m-0"
              >
                {signal.label}
              </Tag>
            ))}
          </div>
        </div>
      </div>

      {/* 底部: 分项得分条 */}
      <div className="mt-4 grid grid-cols-5 gap-2">
        {RADAR_INDICATORS.map((indicator, index) => (
          <div key={indicator.name} className="text-center">
            <div className="text-xs text-gray-300 mb-1">{indicator.name}</div>
            <div className="flex items-center justify-center gap-1">
              <div className="h-1.5 flex-1 bg-[#1f1f3a] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(scores[index] / indicator.max) * 100}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </div>
              <span className="text-xs text-gray-300 w-6 text-right">
                {Math.round(scores[index])}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default TechnicalEvaluationCard