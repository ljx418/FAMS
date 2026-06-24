import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, fonts, darkTheme } from '../../styles/chartTheme'

export interface EquityDataPoint {
  date: string
  equity: number
  benchmark?: number
}

export interface DrawdownPoint {
  date: string
  drawdown: number
}

interface EquityCurveChartProps {
  data: EquityDataPoint[]
  showDrawdown?: boolean
  showBenchmark?: boolean
  showArea?: boolean
  height?: number
}

const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  data,
  showDrawdown = false,
  showBenchmark = false,
  showArea = true,
  height = 400,
}) => {
  const option: EChartsOption = useMemo(() => {
    const dates = data.map((d) => d.date)
    const equityData = data.map((d) => d.equity)
    const benchmarkData = showBenchmark ? data.map((d) => d.benchmark || 0) : []

    // 计算回撤
    let maxEquity = 0
    const drawdownData = data.map((d) => {
      if (d.equity > maxEquity) maxEquity = d.equity
      const drawdown = maxEquity > 0 ? ((d.equity - maxEquity) / maxEquity) * 100 : 0
      return drawdown
    })

    const gridHeight = showDrawdown ? '55%' : '75%'
    const gridTop = showDrawdown ? '15%' : '10%'

    const seriesList: any[] = [
      {
        name: '权益',
        type: 'line',
        data: equityData,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: colors.primary,
          width: 2,
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
                  { offset: 0, color: `${colors.primary}40` },
                  { offset: 1, color: `${colors.primary}05` },
                ],
              },
            }
          : undefined,
        emphasis: {
          scale: true,
          scaleSize: 8,
        },
      },
    ]

    if (showBenchmark) {
      seriesList.push({
        name: '基准',
        type: 'line',
        data: benchmarkData,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: colors.accent,
          width: 1.5,
          type: 'dashed' as const,
        },
      })
    }

    if (showDrawdown) {
      seriesList.push({
        name: '回撤',
        type: 'line',
        data: drawdownData,
        xAxisIndex: showDrawdown ? 1 : 0,
        yAxisIndex: showDrawdown ? 1 : 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: colors.rising,
          width: 1,
        },
        areaStyle: {
          color: {
            type: 'linear' as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${colors.rising}30` },
              { offset: 1, color: `${colors.rising}05` },
            ],
          },
        },
      })
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
          const date = params[0]?.axisValue
          let html = `<div style="font-family: ${fonts.family}; padding: 4px;">`
          html += `<div style="color: ${colors.textSecondary}; margin-bottom: 8px;">${date}</div>`

          params.forEach((p: any) => {
            if (p.value === undefined || p.value === null) return
            const marker = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${p.color}; margin-right: 8px;"></span>`

            if (p.seriesName === '权益') {
              html += `<div>${marker} ${p.seriesName}: <strong style="color: ${colors.primary};">¥${p.value.toLocaleString()}</strong></div>`
            } else if (p.seriesName === '基准') {
              html += `<div>${marker} ${p.seriesName}: <strong style="color: ${colors.accent};">${p.value.toFixed(2)}</strong></div>`
            } else if (p.seriesName === '回撤') {
              html += `<div>${marker} ${p.seriesName}: <strong style="color: ${colors.rising};">${p.value.toFixed(2)}%</strong></div>`
            }
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
      },
      grid: [
        {
          left: '8%',
          right: '5%',
          top: gridTop,
          height: gridHeight,
        },
        ...(showDrawdown
          ? [
              {
                left: '8%',
                right: '5%',
                top: '72%',
                height: '18%',
              },
            ]
          : []),
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: fonts.size.sm,
            fontFamily: fonts.family,
          },
        },
        ...(showDrawdown
          ? [
              {
                type: 'category' as const,
                data: dates,
                gridIndex: 1,
                axisLine: { lineStyle: { color: colors.grid } },
                axisTick: { show: false },
                axisLabel: { show: false },
              },
            ]
          : []),
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          gridIndex: 0,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: colors.gridLight } },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: fonts.size.sm,
            fontFamily: fonts.family,
            formatter: (value: number) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
              if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
              return value.toFixed(0)
            },
          },
        },
        ...(showDrawdown
          ? [
              {
                type: 'value' as const,
                scale: true,
                gridIndex: 1,
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { lineStyle: { color: colors.gridLight } },
                axisLabel: {
                  color: colors.textSecondary,
                  fontSize: fonts.size.sm,
                  fontFamily: fonts.family,
                  formatter: (value: number) => `${value.toFixed(1)}%`,
                },
                max: 0,
              },
            ]
          : []),
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: showDrawdown ? [0, 1] : [0],
          start: 70,
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: showDrawdown ? [0, 1] : [0],
          bottom: '2%',
          height: 20,
          borderColor: colors.grid,
          backgroundColor: colors.card,
          fillerColor: 'rgba(90, 107, 255, 0.2)',
          handleStyle: { color: colors.primary },
          textStyle: { color: colors.textSecondary },
        },
      ],
      series: seriesList,
    } as EChartsOption
  }, [data, showDrawdown, showBenchmark, showArea])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default EquityCurveChart
