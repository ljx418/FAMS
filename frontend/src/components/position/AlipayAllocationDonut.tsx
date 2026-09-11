import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'

export type AlipayAllocationAsset = {
  symbol: string
  name: string
  value: number
  proportion: number
  pnl: number
  pnlPercent: number
}

export type AlipayAllocationSlice = {
  key: string
  tag: string
  label: string
  color: string
  currentValue: number
  currentRatio: number
  targetValue: number
  targetRatio: number
  deviationPctPoint: number
  triggered: boolean
  triggerReason: string
  assets: AlipayAllocationAsset[]
}

type AlipayAllocationDonutProps = {
  slices: AlipayAllocationSlice[]
  totalValue: number
  onAssetClick?: (symbol: string, name: string) => void
}

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const formatCurrency = (value: number) => currencyFormatter.format(value)
const formatPercent = (value: number) => `${value.toFixed(2)}%`
const formatSignedPercentPoint = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}pp`

export default function AlipayAllocationDonut({
  slices,
  totalValue,
  onAssetClick,
}: AlipayAllocationDonutProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReactECharts>(null)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const activeSlice = slices.find((slice) => slice.key === activeKey) || null

  const activate = useCallback((key: string) => {
    if (!pinnedKey) setActiveKey(key)
  }, [pinnedKey])

  const clearTransient = useCallback(() => {
    if (!pinnedKey) setActiveKey(null)
  }, [pinnedKey])

  const togglePinned = useCallback((key: string) => {
    setPinnedKey((previous) => {
      const next = previous === key ? null : key
      setActiveKey(next)
      return next
    })
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let frame = 0
    let timer = 0
    const resizeChart = () => {
      const container = chartContainerRef.current
      const instance = chartRef.current?.getEchartsInstance()
      if (!container || !instance || container.clientWidth <= 0 || container.clientHeight <= 0) return
      instance.resize({ width: container.clientWidth, height: container.clientHeight })
    }
    frame = window.requestAnimationFrame(resizeChart)
    timer = window.setTimeout(resizeChart, 180)
    const observer = new ResizeObserver(resizeChart)
    if (chartContainerRef.current) observer.observe(chartContainerRef.current)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [compact])

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 320,
    aria: {
      enabled: true,
      description: `支付宝当前资产配置及批准目标。账户总额${formatCurrency(totalValue)}。实色内环表示当前比例，虚线外环表示目标比例。`,
    },
    tooltip: { show: false },
    series: [
      {
        name: '批准目标',
        type: 'pie',
        radius: compact ? [82, 96] : ['78%', '90%'],
        center: compact ? ['50%', '24%'] : ['31%', '50%'],
        silent: false,
        selectedMode: false,
        label: { show: false },
        emphasis: { scale: false },
        data: slices.map((slice) => ({
          name: slice.label,
          value: slice.targetRatio,
          bucketKey: slice.key,
          itemStyle: {
            color: `${slice.color}12`,
            borderColor: slice.color,
            borderWidth: 3,
            borderType: 'dashed',
          },
        })),
      },
      {
        name: '当前比例',
        type: 'pie',
        radius: compact ? [54, 72] : ['42%', '70%'],
        center: compact ? ['50%', '24%'] : ['31%', '50%'],
        minAngle: 2,
        selectedMode: false,
        label: { show: false },
        itemStyle: {
          borderColor: '#ffffff',
          borderWidth: 3,
          borderRadius: 5,
        },
        emphasis: {
          scale: true,
          scaleSize: 7,
          itemStyle: {
            shadowBlur: 16,
            shadowColor: 'rgba(15, 23, 42, 0.24)',
          },
        },
        data: slices.map((slice) => ({
          name: slice.label,
          value: slice.currentValue,
          bucketKey: slice.key,
          itemStyle: { color: slice.color },
        })),
      },
    ],
  }), [compact, slices, totalValue])

  const chartEvents = useMemo(() => ({
    mouseover: (params: any) => {
      const key = params?.data?.bucketKey
      if (typeof key === 'string') activate(key)
    },
    globalout: clearTransient,
    click: (params: any) => {
      const key = params?.data?.bucketKey
      if (typeof key === 'string') togglePinned(key)
    },
  }), [activate, clearTransient, togglePinned])

  const closeOverlay = useCallback(() => {
    setPinnedKey(null)
    setActiveKey(null)
  }, [])

  return (
    <section
      className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"
      aria-label="支付宝资产配置饼图"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeOverlay()
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-950">支付宝资产配置</h3>
          <p className="mt-1 text-sm text-slate-600">悬停或获焦查看内部结构；手机点击可锁定详情。</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold text-slate-700" aria-label="图表图例">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-blue-700" aria-hidden />实色＝当前
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm border-2 border-dashed border-blue-700 bg-white" aria-hidden />虚线＝目标
          </span>
        </div>
      </div>

      <div ref={chartContainerRef} className="relative h-[720px] overflow-hidden rounded-lg bg-white md:h-[460px]" data-testid="alipay-allocation-chart">
        <ReactECharts
          ref={chartRef}
          option={option}
          onEvents={chartEvents}
          notMerge
          lazyUpdate
          style={{ height: '100%', minHeight: 460, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />

        <div className="pointer-events-none absolute left-1/2 top-[24%] -translate-x-1/2 -translate-y-1/2 text-center md:left-[31%] md:top-1/2">
          <div className="text-xs font-semibold text-slate-500">支付宝总额</div>
          <div className="mt-1 text-lg font-extrabold text-slate-950">{formatCurrency(totalValue)}</div>
        </div>

        <div
          className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur md:bottom-auto md:left-auto md:right-4 md:top-14 md:w-[42%] md:max-w-[370px]"
          data-testid="alipay-allocation-overlay"
          role="status"
          aria-live="polite"
        >
          {activeSlice ? (
            <div data-testid={`alipay-allocation-detail-${activeSlice.key}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: activeSlice.color }} aria-hidden />
                    <h4 className="truncate text-base font-bold text-slate-950">{activeSlice.label}</h4>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{activeSlice.triggerReason}</p>
                </div>
                {pinnedKey === activeSlice.key && (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                    onClick={closeOverlay}
                    aria-label="关闭资产结构浮层"
                  >
                    关闭
                  </button>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-xs text-slate-500">当前</dt>
                  <dd className="mt-0.5 font-bold text-slate-950">{formatPercent(activeSlice.currentRatio)}</dd>
                  <dd className="text-xs text-slate-600">{formatCurrency(activeSlice.currentValue)}</dd>
                </div>
                <div className="rounded-lg border border-dashed border-slate-400 bg-white p-2">
                  <dt className="text-xs text-slate-500">批准目标</dt>
                  <dd className="mt-0.5 font-bold text-slate-950">{formatPercent(activeSlice.targetRatio)}</dd>
                  <dd className="text-xs text-slate-600">{formatCurrency(activeSlice.targetValue)}</dd>
                </div>
              </dl>

              <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-700">偏离 {formatSignedPercentPoint(activeSlice.deviationPctPoint)}</span>
                <span className={`font-bold ${activeSlice.targetValue >= activeSlice.currentValue ? 'text-blue-700' : 'text-amber-700'}`}>
                  {activeSlice.targetValue >= activeSlice.currentValue ? '缺口' : '盈余'} {formatCurrency(Math.abs(activeSlice.targetValue - activeSlice.currentValue))}
                </span>
              </div>

              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>内部持仓</span>
                  <span>{activeSlice.assets.length} 个标的</span>
                </div>
                {activeSlice.assets.length > 0 ? (
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {activeSlice.assets.map((asset) => (
                      <button
                        key={asset.symbol}
                        type="button"
                        className="grid w-full grid-cols-[68px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-blue-50"
                        onClick={() => onAssetClick?.(asset.symbol, asset.name)}
                        title={`${asset.name}，持仓${formatCurrency(asset.value)}，类内占比${formatPercent(asset.proportion)}`}
                      >
                        <span className="font-mono text-xs font-bold text-blue-700">{asset.symbol}</span>
                        <span className="truncate text-xs text-slate-700">{asset.name}</span>
                        <span className="text-right text-xs font-semibold text-slate-950">
                          <span className="block">
                            {formatCurrency(asset.value)}
                            <span className="ml-1 text-slate-500">{asset.proportion.toFixed(1)}%</span>
                          </span>
                          <span className={`mt-0.5 block text-[11px] ${asset.pnl >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                            持有盈亏 {asset.pnl >= 0 ? '+' : ''}{formatCurrency(asset.pnl)} ({asset.pnlPercent >= 0 ? '+' : ''}{asset.pnlPercent.toFixed(2)}%)
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">当前类别没有可展示的持仓明细。</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">查看内部结构</div>
              <p className="mt-3 max-w-64 text-sm leading-6 text-slate-600">
                将鼠标移到任一扇区，或使用下方类别按钮，即可比较当前比例、批准目标和内部标的。
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="支付宝资产类别">
        {slices.map((slice) => {
          const selected = activeKey === slice.key
          return (
            <button
              key={slice.key}
              type="button"
              aria-pressed={pinnedKey === slice.key}
              aria-label={`${slice.label}，当前${formatPercent(slice.currentRatio)}，目标${formatPercent(slice.targetRatio)}`}
              data-testid={`alipay-allocation-trigger-${slice.key}`}
              className={`rounded-lg border px-3 py-2 text-left transition ${selected ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-400'}`}
              onMouseEnter={() => activate(slice.key)}
              onMouseLeave={clearTransient}
              onFocus={() => activate(slice.key)}
              onBlur={clearTransient}
              onClick={() => togglePinned(slice.key)}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden />
                {slice.label}
              </span>
              <span className="mt-1 block text-xs text-slate-600">
                当前 {slice.currentRatio.toFixed(1)}% · 目标 {slice.targetRatio.toFixed(1)}%
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
