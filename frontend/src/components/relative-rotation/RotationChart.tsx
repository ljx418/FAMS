import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import type { RotationQuadrant, RotationTimelineItem } from '../../services/relativeRotationService'

const seriesColors = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#0284c7', '#65a30d', '#be123c', '#4f46e5']

const quadrantLabels: Record<RotationQuadrant, string> = {
  leading: '领先',
  weakening: '弱化',
  lagging: '落后',
  improving: '改善',
}

interface RotationChartProps {
  items: RotationTimelineItem[]
  headDate: string
  tailLength: number
  loading?: boolean
  reducedMotion?: boolean
}

const roundedRadius = (values: number[]) => {
  const furthest = Math.max(2.5, ...values.map((value) => Math.abs(value - 100)))
  return Math.ceil((furthest * 1.14) * 2) / 2
}

export function RotationChart({ items, headDate, tailLength, loading, reducedMotion }: RotationChartProps) {
  const axisBounds = useMemo(() => {
    const allTimelinePoints = items.flatMap((item) => item.points)
    const xRadius = roundedRadius(allTimelinePoints.map((point) => point.relativeTrend))
    const yRadius = roundedRadius(allTimelinePoints.map((point) => point.relativeMomentum))

    return {
      xMin: 100 - xRadius,
      xMax: 100 + xRadius,
      yMin: 100 - yRadius,
      yMax: 100 + yRadius,
    }
  }, [items])

  const option = useMemo<EChartsOption>(() => {
    const chartItems = items
      .map((item) => ({
        item,
        points: item.points.filter((point) => point.date <= headDate).slice(-tailLength),
      }))
      .filter(({ points }) => points.length > 0)

    const assetSeries: any[] = chartItems.flatMap(({ item, points }, itemIndex) => {
      const color = seriesColors[itemIndex % seriesColors.length]
      const name = `${item.name} ${item.symbol}`
      const limited = item.readiness === 'limited'
      const aged = item.freshness === 'stale' || item.freshness === 'unknown'
      const chartData = points.map((point) => [
        point.relativeTrend,
        point.relativeMomentum,
        point.date,
        point.quadrant,
        point.deltaX,
        point.deltaY,
        point.speed,
      ])
      return [{
        id: `rrg-${item.targetKey}`,
        name,
        type: 'line' as const,
        z: 5,
        data: chartData,
        encode: { x: 0, y: 1 },
        showSymbol: false,
        smooth: 0.18,
        lineStyle: {
          color,
          width: 2.6,
          opacity: aged ? 0.46 : 0.82,
          type: limited ? 'dashed' as const : 'solid' as const,
          cap: 'round' as const,
          join: 'round' as const,
          shadowBlur: 3,
          shadowColor: `${color}26`,
        },
        emphasis: {
          focus: 'series' as const,
          lineStyle: { width: 4, opacity: 1 },
        },
        ...(itemIndex === 0 ? {
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            label: { show: false },
            lineStyle: { color: '#94a3b8', width: 1.2, type: 'dashed' as const },
            data: [{ xAxis: 100 }, { yAxis: 100 }],
          },
        } : {}),
        endLabel: { show: false },
        animationDurationUpdate: reducedMotion ? 0 : 320,
        animationEasingUpdate: 'cubicOut' as const,
      }, {
        id: `rrg-dots-${item.targetKey}`,
        name,
        type: 'scatter' as const,
        z: 6,
        data: chartData.slice(0, -1),
        encode: { x: 0, y: 1 },
        symbolSize: (_value: unknown, params: { dataIndex: number }) => (
          3 + ((params.dataIndex / Math.max(1, chartData.length - 1)) * 3)
        ),
        itemStyle: { color, opacity: aged ? 0.22 : 0.46, borderColor: '#ffffff', borderWidth: 0.8 },
        emphasis: { focus: 'series' as const, scale: 1.2 },
        animationDurationUpdate: reducedMotion ? 0 : 320,
        animationEasingUpdate: 'cubicOut' as const,
      }, {
        id: `rrg-head-${item.targetKey}`,
        name,
        type: 'scatter' as const,
        z: 8,
        data: chartData.slice(-1),
        encode: { x: 0, y: 1 },
        symbolSize: 14,
        itemStyle: {
          color,
          opacity: aged ? 0.62 : 1,
          borderColor: '#ffffff',
          borderWidth: 2.5,
          shadowBlur: 10,
          shadowColor: `${color}66`,
        },
        label: {
          show: true,
          formatter: item.name,
          position: 'top' as const,
          distance: 9,
          color: '#0f172a',
          fontSize: 11,
          fontWeight: 600,
          backgroundColor: 'rgba(255,255,255,0.92)',
          borderColor: `${color}55`,
          borderWidth: 1,
          borderRadius: 5,
          padding: [4, 6],
        },
        emphasis: { focus: 'series' as const, scale: 1.25 },
        animationDurationUpdate: reducedMotion ? 0 : 320,
        animationEasingUpdate: 'cubicOut' as const,
      }]
    })

    return {
      animation: !reducedMotion,
      // Render the first frame immediately; only timeline updates animate.
      // This also avoids a blank chart in browsers that throttle first-paint RAF.
      animationDuration: 0,
      animationDurationUpdate: reducedMotion ? 0 : 320,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
      color: seriesColors,
      aria: {
        enabled: true,
        decal: { show: false },
        label: { description: `相对轮动图，头部日期 ${headDate}，显示 ${chartItems.length} 个持仓或自选标的。` },
      },
      grid: { left: 70, right: 54, top: 30, bottom: 78, containLabel: false },
      legend: {
        type: 'scroll',
        bottom: 12,
        left: 46,
        right: 46,
        itemWidth: 18,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { color: '#475569', fontSize: 12 },
        pageIconColor: '#2563eb',
        pageTextStyle: { color: '#64748b' },
        data: chartItems.map(({ item }) => `${item.name} ${item.symbol}`),
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        borderWidth: 0,
        padding: [11, 13],
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        textStyle: { color: '#f8fafc', fontSize: 12, lineHeight: 20 },
        extraCssText: 'box-shadow: 0 16px 40px rgba(15, 23, 42, .22); border-radius: 10px;',
        formatter: (params: any) => {
          const values = params.value
          if (!Array.isArray(values) || values.length < 4) return params.seriesName
          const meta = {
            date: values[2],
            quadrantLabel: quadrantLabels[values[3] as RotationQuadrant] || values[3],
            deltaX: values[4],
            deltaY: values[5],
            speed: values[6],
          }
          const signed = (value: number | null) => value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
          return [
            `<div style="font-size:13px;font-weight:700;margin-bottom:3px">${params.seriesName}</div>`,
            `<span style="color:#cbd5e1">${meta.date}</span> · ${meta.quadrantLabel}`,
            `相对趋势&nbsp;&nbsp;<b>${Number(values[0]).toFixed(3)}</b>`,
            `相对动量&nbsp;&nbsp;<b>${Number(values[1]).toFixed(3)}</b>`,
            `方向向量&nbsp;&nbsp;${signed(meta.deltaX)} / ${signed(meta.deltaY)}`,
            `移动速度&nbsp;&nbsp;${meta.speed == null ? '--' : Number(meta.speed).toFixed(3)}`,
          ].join('<br/>')
        },
      },
      xAxis: {
        type: 'value',
        name: '相对趋势  →',
        nameLocation: 'middle',
        nameGap: 40,
        min: axisBounds.xMin,
        max: axisBounds.xMax,
        splitNumber: 6,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisTick: { show: false },
        axisLabel: { color: '#64748b', fontSize: 11, formatter: (value: number) => value.toFixed(1) },
        nameTextStyle: { color: '#475569', fontSize: 12, fontWeight: 600 },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed', opacity: 0.8 } },
      },
      yAxis: {
        type: 'value',
        name: '相对动量  ↑',
        nameLocation: 'middle',
        nameGap: 50,
        min: axisBounds.yMin,
        max: axisBounds.yMax,
        splitNumber: 6,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisTick: { show: false },
        axisLabel: { color: '#64748b', fontSize: 11, formatter: (value: number) => value.toFixed(1) },
        nameTextStyle: { color: '#475569', fontSize: 12, fontWeight: 600 },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed', opacity: 0.8 } },
      },
      series: assetSeries,
    } as EChartsOption
  }, [axisBounds, headDate, items, reducedMotion, tailLength])

  return (
    <div className="relative w-full" style={{ height: 'clamp(480px, 58vw, 640px)' }}>
      <div
        className="pointer-events-none absolute grid grid-cols-2 grid-rows-2 overflow-hidden"
        style={{ left: 70, right: 54, top: 30, bottom: 78 }}
        aria-hidden="true"
      >
        <div className="bg-blue-50/60 p-3 text-xs font-semibold text-slate-500">改善 · IMPROVING</div>
        <div className="bg-emerald-50/60 p-3 text-xs font-semibold text-slate-500">领先 · LEADING</div>
        <div className="bg-rose-50/50 p-3 text-xs font-semibold text-slate-500">落后 · LAGGING</div>
        <div className="bg-amber-50/50 p-3 text-xs font-semibold text-slate-500">弱化 · WEAKENING</div>
      </div>
      <ReactECharts
        option={option}
        showLoading={loading}
        style={{ height: '100%', width: '100%', position: 'relative', zIndex: 1 }}
        notMerge={false}
        lazyUpdate
      />
    </div>
  )
}
