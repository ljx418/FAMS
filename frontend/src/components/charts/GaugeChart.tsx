import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts } from '../../styles/chartTheme'

interface GaugeChartProps {
  value: number
  max?: number
  min?: number
  label?: string
  subLabel?: string
  color?: string
  startColor?: string
  endColor?: string
  height?: number
  showValue?: boolean
  showAxisLabel?: boolean
  unit?: string
}

// 风险等级颜色
const riskColors = [
  'success', // 低风险 - 绿色
  '#FAC858', // 中低 - 黄色
  '#FFA500', // 中等 - 橙色
  'danger', // 高风险 - 红色
]

const GaugeChart: React.FC<GaugeChartProps> = ({
  value,
  max = 100,
  min = 0,
  label = '风险评分',
  subLabel,
  color,
  startColor = colors.rising,
  endColor = colors.falling,
  height = 300,
  showValue = true,
  showAxisLabel = true,
  unit = '',
}) => {
  const option: EChartsOption = useMemo(() => {
    const percentage = ((value - min) / (max - min)) * 100
    // const formattedValue = value % 1 === 0 ? value.toString() : value.toFixed(1)

    // 根据百分比选择风险颜色
    const gaugeColor = color || (percentage < 25 ? riskColors[0] : percentage < 50 ? riskColors[1] : percentage < 75 ? riskColors[2] : riskColors[3])

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 1000,
      animationEasing: 'cubicOut',
      series: [
        {
          type: 'gauge',
          center: ['50%', '60%'],
          startAngle: 200,
          endAngle: -20,
          min: min,
          max: max,
          splitNumber: 5,
          radius: '90%',
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                [percentage / 100, gaugeColor],
                [1, colors.gridLight],
              ],
            },
          },
          pointer: {
            icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
            length: '55%',
            width: 8,
            offsetCenter: [0, '-10%'],
            itemStyle: {
              color: gaugeColor,
            },
          },
          axisTick: {
            length: 8,
            lineStyle: {
              color: 'auto',
              width: 1,
            },
          },
          splitLine: {
            length: 14,
            lineStyle: {
              color: 'auto',
              width: 2,
            },
          },
          axisLabel: {
            show: showAxisLabel,
            color: colors.textSecondary,
            fontSize: fonts.size.sm,
            fontFamily: fonts.family,
            distance: 25,
          },
          title: {
            show: !!subLabel,
            offset: [0, '30%'],
            fontSize: fonts.size.sm,
            fontFamily: fonts.family,
            color: colors.textSecondary,
          },
          detail: {
            show: showValue,
            offsetCenter: [0, '20%'],
            fontSize: fonts.size.xxl,
            fontWeight: fonts.weight.bold,
            fontFamily: fonts.family,
            formatter: `{value}${unit}`,
            color: gaugeColor,
            valueAnimation: true,
          },
          data: [
            {
              value: value,
              name: subLabel,
            },
          ],
        },
      ],
    } as EChartsOption
  }, [value, max, min, color, startColor, endColor, label, subLabel, showValue, showAxisLabel, unit])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default GaugeChart
