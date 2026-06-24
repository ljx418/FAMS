import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts, darkTheme } from '../../styles/chartTheme'

export interface YieldPoint {
  tenor: string  // 如 "1M", "3M", "1Y", "5Y", "10Y"
  yield: number
}

export interface YieldCurveData {
  name: string
  data: YieldPoint[]
  color?: string
}

interface YieldCurveChartProps {
  data: YieldCurveData[]
  benchmark?: YieldCurveData
  showArea?: boolean
  showYieldLabel?: boolean
  height?: number
}

const YieldCurveChart: React.FC<YieldCurveChartProps> = ({
  data,
  benchmark,
  showArea = false,
  showYieldLabel = true,
  height = 400,
}) => {
  const option: EChartsOption = useMemo(() => {
    const tenors = data[0]?.data.map((d) => d.tenor) || []

    const seriesList = data.map((curve, index) => {
      const values = curve.data.map((d) => d.yield)

      return {
        name: curve.name,
        type: 'line' as const,
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: {
          color: curve.color || (index === 0 ? colors.primary : colors.accent),
          width: index === 0 ? 2.5 : 2,
        },
        itemStyle: {
          color: curve.color || (index === 0 ? colors.primary : colors.accent),
          borderWidth: 2,
          borderColor: colors.card,
        },
        areaStyle: showArea
          ? {
              color: {
                type: 'linear' as const,
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: `${curve.color || colors.primary}40` },
                  { offset: 1, color: `${curve.color || colors.primary}05` },
                ],
              },
            }
          : undefined,
        emphasis: {
          scale: true,
          scaleSize: 10,
        },
        label: showYieldLabel
          ? {
              show: true,
              position: 'top',
              formatter: (params: any) => `${params.value.toFixed(2)}%`,
              color: colors.textSecondary,
              fontSize: fonts.size.xs,
            }
          : undefined,
      }
    })

    // Benchmark series
    if (benchmark) {
      const benchmarkValues = benchmark.data.map((d) => d.yield)
      seriesList.push({
        name: benchmark.name,
        type: 'line' as const,
        data: benchmarkValues,
        smooth: true,
        symbol: 'diamond',
        symbolSize: 6,
        lineStyle: {
          color: colors.textSecondary,
          width: 1.5,
          type: 'dashed' as const,
        } as any,
        itemStyle: {
          color: colors.textSecondary,
          borderWidth: 2,
          borderColor: colors.card,
        },
        label: showYieldLabel
          ? {
              show: true,
              position: 'bottom',
              formatter: (params: any) => `${params.value.toFixed(2)}%`,
              color: colors.textSecondary,
              fontSize: fonts.size.xs,
            }
          : undefined,
      } as any)
    }

    return {
      ...darkTheme,
      animation: true,
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.card,
        borderColor: colors.border,
        textStyle: { color: colors.text, fontFamily: fonts.family },
        formatter: (params: any) => {
          const tenor = params[0]?.axisValue
          let html = `<div style="font-family: ${fonts.family}; padding: 4px;">`
          html += `<div style="color: ${colors.textSecondary}; margin-bottom: 8px;">期限: ${tenor}</div>`

          params.forEach((p: any) => {
            const marker = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${p.color}; margin-right: 8px;"></span>`
            html += `<div style="margin-bottom: 4px;">${marker} ${p.seriesName}: <strong>${p.value.toFixed(3)}%</strong></div>`
          })

          html += '</div>'
          return html
        },
      },
      legend: {
        show: true,
        top: 0,
        right: '10%',
        textStyle: { color: colors.textSecondary, fontFamily: fonts.family },
        itemWidth: 20,
        itemHeight: 10,
        itemGap: 20,
      },
      grid: {
        left: '8%',
        right: '5%',
        top: '15%',
        bottom: '10%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: tenors,
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.sm,
          fontFamily: fonts.family,
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: colors.gridLight } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.sm,
          fontFamily: fonts.family,
          formatter: (value: number) => `${value.toFixed(2)}%`,
        },
      },
      series: seriesList,
    } as EChartsOption
  }, [data, benchmark, showArea, showYieldLabel])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default YieldCurveChart
