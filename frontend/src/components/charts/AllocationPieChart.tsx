import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts } from '../../styles/chartTheme'

export interface AllocationItem {
  name: string
  value: number
  color?: string
}

interface AllocationPieChartProps {
  data: AllocationItem[]
  type?: 'pie' | 'donut' | 'rose'
  showLegend?: boolean
  showLabel?: boolean
  showPercent?: boolean
  radius?: [number, number] | string
  height?: number
  center?: [string, string]
}

// 默认颜色列表
const defaultColors = [
  '#5a6bff',
  'success',
  '#FAC858',
  'danger',
  '#00BFFF',
  '#FF69B4',
  '#9370DB',
  '#20B2AA',
  '#FF6347',
  '#4682B4',
]

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({
  data,
  type = 'donut',
  showLegend = true,
  showLabel = true,
  showPercent = true,
  radius = ['40%', '70%'],
  height = 400,
  center = ['50%', '50%'],
}) => {
  const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data])

  const option: EChartsOption = useMemo(() => {
    const processedData = data.map((item, index) => ({
      name: item.name,
      value: item.value,
      itemStyle: {
        color: item.color || defaultColors[index % defaultColors.length],
      },
    }))

    let labelFormatter: any = undefined
    if (showLabel) {
      labelFormatter = (params: any) => {
        const percent = showPercent ? `${((params.value / total) * 100).toFixed(1)}%` : ''
        return `${params.name}\n${percent}`
      }
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.card,
        borderColor: colors.border,
        textStyle: { color: colors.text, fontFamily: fonts.family },
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(2)
          return `
            <div style="font-family: ${fonts.family}; padding: 4px;">
              <div style="color: ${params.color}; font-weight: 600;">${params.name}</div>
              <div style="margin-top: 4px;">
                <span style="color: ${colors.text};">¥${params.value.toLocaleString()}</span>
                <span style="color: ${colors.textSecondary}; margin-left: 8px;">${percent}%</span>
              </div>
            </div>
          `
        },
      },
      legend: showLegend
        ? {
            orient: 'vertical',
            right: '5%',
            top: 'center',
            textStyle: { color: colors.textSecondary, fontFamily: fonts.family },
            itemWidth: 14,
            itemHeight: 14,
            itemGap: 12,
            formatter: (name: string) => {
              const item = data.find((d) => d.name === name)
              if (!item) return name
              const percent = ((item.value / total) * 100).toFixed(1)
              return `${name}  ${percent}%`
            },
          }
        : undefined,
      series: [
        {
          name: '资产配置',
          type: 'pie',
          center: type === 'pie' ? ['50%', '50%'] : center,
          radius: type === 'pie' ? '70%' : radius,
          roseType: type === 'rose' ? 'radius' : undefined,
          itemStyle: {
            borderRadius: 4,
            borderColor: colors.background,
            borderWidth: 2,
          },
          label: {
            show: showLabel,
            position: type === 'rose' ? 'outside' : 'inner',
            formatter: labelFormatter,
            color: colors.text,
            fontFamily: fonts.family,
            fontSize: fonts.size.sm,
          },
          labelLine: {
            show: showLabel,
            lineStyle: { color: colors.grid },
          },
          emphasis: {
            scale: true,
            scaleSize: 8,
            itemStyle: {
              shadowBlur: 20,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
          data: processedData,
        },
      ],
    } as EChartsOption
  }, [data, type, showLegend, showLabel, showPercent, radius, height, center, total])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default AllocationPieChart
