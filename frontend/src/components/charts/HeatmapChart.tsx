import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts, darkTheme } from '../../styles/chartTheme'

export interface HeatmapDataPoint {
  x: string    // 行业名或日期
  y: string    // 日期或行业名
  value: number
}

interface HeatmapChartProps {
  data: HeatmapDataPoint[]
  xLabels?: string[]   // X轴标签
  yLabels?: string[]   // Y轴标签
  colorScale?: 'default' | 'red' | 'green' | 'blue'
  min?: number
  max?: number
  height?: number
  showValue?: boolean
}

// 颜色刻度配置
const colorScales = {
  default: [
    [0.0, 'surface-border'],
    [0.25, '#3d5a80'],
    [0.5, '#7B68EE'],
    [0.75, '#ee6c4d'],
    [1.0, 'danger'],
  ],
  red: [
    [0.0, '#1a1a2e'],
    [0.3, '#4a1a1a'],
    [0.5, '#8B0000'],
    [0.7, '#CD5C5C'],
    [1.0, 'danger'],
  ],
  green: [
    [0.0, '#1a2e1a'],
    [0.3, '#2d5a2d'],
    [0.5, '#228B22'],
    [0.7, '#90EE90'],
    [1.0, 'success'],
  ],
  blue: [
    [0.0, '#1a1a2e'],
    [0.3, '#1a3a5a'],
    [0.5, '#1E90FF'],
    [0.7, '#87CEEB'],
    [1.0, '#00BFFF'],
  ],
}

const HeatmapChart: React.FC<HeatmapChartProps> = ({
  data,
  xLabels,
  yLabels,
  colorScale = 'default',
  min,
  max,
  height = 400,
  showValue = false,
}) => {
  const option: EChartsOption = useMemo(() => {
    const processedData = data.map((d) => [d.x, d.y, d.value])
    const dataMin = min ?? Math.min(...data.map((d) => d.value))
    const dataMax = max ?? Math.max(...data.map((d) => d.value))

    return {
      ...darkTheme,
      animation: true,
      tooltip: {
        trigger: 'item',
        backgroundColor: colors.card,
        borderColor: colors.border,
        textStyle: { color: colors.text, fontFamily: fonts.family },
        formatter: (params: any) => {
          const [x, y, value] = params.data
          return `
            <div style="font-family: ${fonts.family}; padding: 4px;">
              <div style="color: ${colors.textSecondary}; margin-bottom: 4px;">${y} / ${x}</div>
              <div style="color: ${value >= 0 ? colors.rising : colors.falling}; font-size: 18px; font-weight: 600;">
                ${value >= 0 ? '+' : ''}${value.toFixed(2)}%
              </div>
            </div>
          `
        },
      },
      grid: {
        left: '15%',
        right: '10%',
        top: '10%',
        bottom: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.sm,
          fontFamily: fonts.family,
          interval: 0,
          rotate: xLabels && xLabels.length > 10 ? 45 : 0,
        },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.sm,
          fontFamily: fonts.family,
        },
      },
      visualMap: {
        min: dataMin,
        max: dataMax,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: '0%',
        inRange: {
          color: colorScales[colorScale].map(([, color]) => color),
        },
        textStyle: {
          color: colors.textSecondary,
          fontFamily: fonts.family,
        },
        formatter: (value: number) => {
          return `${value.toFixed(1)}%`
        },
      },
      series: [
        {
          name: '收益热力图',
          type: 'heatmap',
          data: processedData,
          label: showValue
            ? {
                show: true,
                formatter: (params: any) => {
                  const value = params.data[2]
                  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
                },
                color: colors.text,
                fontSize: fonts.size.xs,
                fontFamily: fonts.family,
              }
            : undefined,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
          itemStyle: {
            borderColor: colors.background,
            borderWidth: 2,
            borderRadius: 2,
          },
        },
      ],
    } as EChartsOption
  }, [data, xLabels, yLabels, colorScale, min, max, showValue])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default HeatmapChart
