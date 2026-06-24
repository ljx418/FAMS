import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, darkTheme, fonts } from '../../styles/chartTheme'

interface MACDData {
  date: string
  dif: number
  dea: number
  macd: number
}

interface MACDChartProps {
  data: MACDData[]
  height?: number
}

const MACDChart: React.FC<MACDChartProps> = ({ data, height = 200 }) => {
  const option: EChartsOption = useMemo(() => {
    const dates = data.map((d) => d.date)
    const difData = data.map((d) => d.dif)
    const deaData = data.map((d) => d.dea)
    const macdData = data.map((d) => ({
      value: d.macd,
      itemStyle: {
        color: d.macd >= 0 ? colors.rising : colors.falling,
      },
    }))

    return {
      ...darkTheme,
      animation: true,
      title: {
        text: 'MACD指标',
        left: 'left',
        top: 0,
        textStyle: {
          color: colors.text,
          fontSize: fonts.size.md,
          fontWeight: fonts.weight.semibold,
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: colors.card,
        borderColor: colors.border,
        textStyle: { color: colors.text },
        formatter: (params: any) => {
          if (!params || params.length === 0) return ''
          const date = params[0].axisValue
          const items = params.map((p: any) => {
            const color = p.seriesName === 'MACD柱'
              ? (p.value >= 0 ? colors.rising : colors.falling)
              : p.color
            return `<span style="color: ${color}">${p.seriesName}: ${p.value?.toFixed(3) || '--'}</span>`
          }).join('<br/>')
          return `<div style="font-family: ${fonts.family}">
            <div style="color: ${colors.textSecondary}; margin-bottom: 4px">${date}</div>
            ${items}
          </div>`
        },
      },
      legend: {
        show: true,
        top: 0,
        right: '10%',
        data: ['DIF', 'DEA', 'MACD柱'],
        textStyle: { color: colors.textSecondary, fontSize: fonts.size.xs },
      },
      grid: {
        left: '10%',
        right: '5%',
        top: '25%',
        bottom: '15%',
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: colors.grid } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.xs,
          formatter: (value: string) => value.slice(5),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: colors.gridLight } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: fonts.size.xs,
          formatter: (value: number) => value.toFixed(2),
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: 70,
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          bottom: '2%',
          height: 15,
          borderColor: colors.grid,
          backgroundColor: colors.card,
          fillerColor: 'rgba(90, 107, 255, 0.2)',
          handleStyle: { color: colors.primary },
          textStyle: { color: colors.textSecondary },
        },
      ],
      series: [
        {
          name: 'DIF',
          type: 'line',
          data: difData,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#00BFFF', width: 1.5 },
        },
        {
          name: 'DEA',
          type: 'line',
          data: deaData,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#FAC858', width: 1.5 },
        },
        {
          name: 'MACD柱',
          type: 'bar',
          data: macdData,
          barWidth: '60%',
        },
      ],
    } as EChartsOption
  }, [data])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default MACDChart