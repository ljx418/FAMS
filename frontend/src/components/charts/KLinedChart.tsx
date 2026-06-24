import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { colors, darkTheme, fonts } from '../../styles/chartTheme'

export interface KLineData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MAData {
  ma5: number[]
  ma10: number[]
  ma20: number[]
  ma60: number[]
}

interface KLinedChartProps {
  data: KLineData[]
  symbol?: string
  period?: string
  showVolume?: boolean
  showMA?: boolean
  height?: number
}

// 计算移动平均线
const calculateMA = (data: KLineData[]): MAData => {
  const result: MAData = { ma5: [], ma10: [], ma20: [], ma60: [] }

  for (let i = 0; i < data.length; i++) {
    // const close = data[i].close

    // MA5
    if (i >= 4) {
      const ma5Sum = data.slice(i - 4, i + 1).reduce((sum, d) => sum + d.close, 0)
      result.ma5.push(ma5Sum / 5)
    } else {
      result.ma5.push(0)
    }

    // MA10
    if (i >= 9) {
      const ma10Sum = data.slice(i - 9, i + 1).reduce((sum, d) => sum + d.close, 0)
      result.ma10.push(ma10Sum / 10)
    } else {
      result.ma10.push(0)
    }

    // MA20
    if (i >= 19) {
      const ma20Sum = data.slice(i - 19, i + 1).reduce((sum, d) => sum + d.close, 0)
      result.ma20.push(ma20Sum / 20)
    } else {
      result.ma20.push(0)
    }

    // MA60
    if (i >= 59) {
      const ma60Sum = data.slice(i - 59, i + 1).reduce((sum, d) => sum + d.close, 0)
      result.ma60.push(ma60Sum / 60)
    } else {
      result.ma60.push(0)
    }
  }

  return result
}

const KLinedChart: React.FC<KLinedChartProps> = ({
  data,
  symbol = 'BTC/USDT',
  period = '1D',
  showVolume = true,
  showMA = true,
  height = 400,
}) => {
  const option: EChartsOption = useMemo(() => {
    const maData = calculateMA(data)
    const dates = data.map((d) => d.date)
    const candleData = data.map((d) => [d.open, d.close, d.low, d.high])
    const volumeData = data.map((d) => ({
      value: d.volume,
      itemStyle: {
        color: d.close >= d.open ? colors.rising : colors.falling,
      },
    }))

    const gridHeight = showVolume ? '55%' : '75%'
    const volumeTop = showVolume ? '70%' : '80%'

    return {
      ...darkTheme,
      animation: true,
      title: {
        text: `${symbol} ${period}`,
        left: 'left',
        top: 0,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: { color: colors.textSecondary },
          lineStyle: { color: colors.accent, type: 'dashed' },
        },
        formatter: (params: any) => {
          const candle = params.find((p: any) => p.seriesName === 'K线')
          if (!candle) return ''

          const [open, close, low, high] = candle.data
          const volume = params.find((p: any) => p.seriesName === '成交量')
          const date = candle.axisValue

          const isRising = close >= open
          const color = isRising ? colors.rising : colors.falling
          const change = ((close - open) / open * 100).toFixed(2)

          return `
            <div style="font-family: ${fonts.family}; padding: 4px;">
              <div style="color: ${colors.textSecondary}; margin-bottom: 8px;">${date}</div>
              <div style="display: grid; grid-template-columns: auto auto; gap: 4px 16px;">
                <span style="color: ${colors.textSecondary};">开盘:</span><span style="color: ${colors.text};">${open.toFixed(2)}</span>
                <span style="color: ${colors.textSecondary};">收盘:</span><span style="color: ${color};">${close.toFixed(2)}</span>
                <span style="color: ${colors.textSecondary};">最低:</span><span style="color: ${colors.text};">${low.toFixed(2)}</span>
                <span style="color: ${colors.textSecondary};">最高:</span><span style="color: ${colors.text};">${high.toFixed(2)}</span>
                <span style="color: ${colors.textSecondary};">涨跌:</span><span style="color: ${color};">${change}%</span>
                ${volume ? `<span style="color: ${colors.textSecondary};">成交量:</span><span style="color: ${colors.text};">${(volume.value / 1000).toFixed(2)}K</span>` : ''}
              </div>
            </div>
          `
        },
      },
      legend: {
        show: showMA,
        top: 0,
        right: '10%',
        data: ['MA5', 'MA10', 'MA20', 'MA60'],
        textStyle: { color: colors.textSecondary },
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        crossStyle: { color: colors.textSecondary },
      },
      grid: [
        {
          left: '10%',
          right: '5%',
          top: '15%',
          height: gridHeight,
        },
        {
          left: '10%',
          right: '5%',
          top: volumeTop,
          height: '15%',
        },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: colors.grid } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: 'category',
          data: dates,
          gridIndex: 1,
          axisLine: { lineStyle: { color: colors.grid } },
          axisLabel: { color: colors.textSecondary, fontSize: fonts.size.sm },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          splitLine: { lineStyle: { color: colors.gridLight } },
          axisLabel: { color: colors.textSecondary, fontSize: fonts.size.sm },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          splitLine: { lineStyle: { color: colors.gridLight } },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: fonts.size.sm,
            formatter: (value: number) => {
              if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M'
              if (value >= 1000) return (value / 1000).toFixed(1) + 'K'
              return value.toFixed(0)
            },
          },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: 70,
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          bottom: '2%',
          height: 20,
          borderColor: colors.grid,
          backgroundColor: colors.card,
          fillerColor: 'rgba(90, 107, 255, 0.2)',
          handleStyle: { color: colors.primary },
          textStyle: { color: colors.textSecondary },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candleData,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: colors.rising,
            color0: colors.falling,
            borderColor: colors.rising,
            borderColor0: colors.falling,
          },
        },
        ...(showMA
          ? [
              {
                name: 'MA5',
                type: 'line' as const,
                data: maData.ma5,
                xAxisIndex: 0,
                yAxisIndex: 0,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: colors.ma5, width: 1 },
              },
              {
                name: 'MA10',
                type: 'line' as const,
                data: maData.ma10,
                xAxisIndex: 0,
                yAxisIndex: 0,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: colors.ma10, width: 1 },
              },
              {
                name: 'MA20',
                type: 'line' as const,
                data: maData.ma20,
                xAxisIndex: 0,
                yAxisIndex: 0,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: colors.ma20, width: 1 },
              },
              {
                name: 'MA60',
                type: 'line' as const,
                data: maData.ma60,
                xAxisIndex: 0,
                yAxisIndex: 0,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: colors.ma60, width: 1 },
              },
            ]
          : []),
        ...(showVolume
          ? [
              {
                name: '成交量',
                type: 'bar' as const,
                data: volumeData,
                xAxisIndex: 1,
                yAxisIndex: 1,
              },
            ]
          : []),
      ],
    } as EChartsOption
  }, [data, symbol, period, showVolume, showMA])

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default KLinedChart
