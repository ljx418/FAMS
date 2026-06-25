import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Row, Select, Tag, message } from 'antd'
import axios from 'axios'
import { useLocation, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'

const { RangePicker } = DatePicker

const formatMoney = (value?: number | null) => `¥${(value || 0).toFixed(2)}`
const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`
const formatSignedMoney = (value?: number | null) => {
  const amount = value || 0
  return `${amount >= 0 ? '+' : '-'}¥${Math.abs(amount).toFixed(2)}`
}
const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id

const DEFAULT_PORTFOLIO_BACKTEST_END_DATE = '2026-06-05'
const RECOMMENDED_PORTFOLIO_STRATEGY_IDS = [
  'dividend_low_vol_basket',
  'current_holdings_buy_and_hold',
  'local_real_data_sample_60_40',
]

const PortfolioCurveChart: React.FC<{ strategies: any[] }> = ({ strategies }) => {
  const completed = strategies.filter((strategy) => Array.isArray(strategy.equityCurve) && strategy.equityCurve.length > 1)
  if (completed.length === 0) {
    return <div className="h-56 flex items-center justify-center text-gray-500">暂无可绘制曲线</div>
  }
  const benchmarkIds = Array.from(new Set(completed.flatMap((strategy) => (
    Object.keys(strategy.equityCurve?.[0]?.benchmark || {})
  )))).slice(0, 2)
  const dates = Array.from(new Set(completed.flatMap((strategy) => strategy.equityCurve.map((point: any) => point.date)))).sort()
  const byDate = (strategy: any, selector: (point: any) => number | null) => {
    const map = new Map((strategy.equityCurve || []).map((point: any) => [point.date, selector(point)]))
    return dates.map((date) => map.get(date) ?? null)
  }
  const benchmarkByDate = (benchmarkId: string) => {
    const map = new Map<string, number>()
    for (const strategy of completed) {
      for (const point of strategy.equityCurve || []) {
        const value = point.benchmark?.[benchmarkId]?.cumulativeReturnPercent
        if (typeof value === 'number' && !map.has(point.date)) map.set(point.date, value)
      }
    }
    return dates.map((date) => map.get(date) ?? null)
  }
  const option: EChartsOption = {
    backgroundColor: 'transparent',
    color: ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#94a3b8', '#f97316'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#e5e7eb' },
      valueFormatter: (value) => `${Number(value).toFixed(2)}%`,
    },
    legend: {
      type: 'scroll',
      top: 0,
      textStyle: { color: '#cbd5e1' },
    },
    grid: [
      { left: 48, right: 24, top: 48, height: 210 },
      { left: 48, right: 24, top: 304, height: 78 },
    ],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: false, axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
      { type: 'category', data: dates, boundaryGap: false, gridIndex: 1, axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
    ],
    yAxis: [
      { type: 'value', name: '累计收益', axisLabel: { color: '#94a3b8', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#1f2937' } } },
      { type: 'value', name: '回撤', gridIndex: 1, axisLabel: { color: '#94a3b8', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#1f2937' } } },
    ],
    series: [
      ...completed.map((strategy) => ({
        name: strategy.definition?.displayName || strategy.definition?.strategyId,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data: byDate(strategy, (point) => Number(point.cumulativeReturnPercent ?? ((point.netValue - 1) * 100))),
      })),
      ...benchmarkIds.map((benchmarkId) => ({
        name: `基准 ${benchmarkId}`,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { type: 'dashed' as const, width: 1.5 },
        data: benchmarkByDate(benchmarkId),
      })),
      ...completed.slice(0, 5).map((strategy) => ({
        name: `${strategy.definition?.displayName || strategy.definition?.strategyId} 回撤`,
        type: 'line' as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.08 },
        data: byDate(strategy, (point) => Number(point.drawdownPercent ?? 0)),
      })),
    ],
  }

  return (
    <div role="img" aria-label="组合策略累计收益、基准和回撤曲线">
      <ReactECharts option={option} style={{ height: 430, width: '100%' }} notMerge lazyUpdate />
    </div>
  )
}

const Backtest: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [loadingResult, setLoadingResult] = useState(false)
  const [loadingAdviceDetail, setLoadingAdviceDetail] = useState(false)
  const [loadingExecutionReview, setLoadingExecutionReview] = useState(false)
  const [backtestOperation, setBacktestOperation] = useState<null | {
    id: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    progressPct?: number
    result?: {
      backtestId?: string
      strategyId?: string
      adviceId?: string
      status?: string
      symbols?: string[]
      startDate?: string
      endDate?: string
      initialCapital?: number
    }
    error?: { message?: string }
  }>(null)
  const [latestRun, setLatestRun] = useState<null | {
    backtestId: string
    strategyId: string
    adviceId: string
    status: string
    symbols: string[]
    startDate: string
    endDate: string
    initialCapital: number
  }>(null)
  const [backtestResult, setBacktestResult] = useState<null | {
    id: string
    status: string
    progress: number
    initialCapital: number
    finalCapital?: number | null
    metrics?: {
      totalReturn?: number | null
      annualizedReturn?: number | null
      maxDrawdown?: number | null
      sharpeRatio?: number | null
      winRate?: number | null
      tradesCount?: number | null
    }
    reviewReport?: {
      kind: 'advice_execution_review'
      version: 'v1'
      adviceId: string
      strategyId: string
      backtestId: string
      generatedAt: string
      windowReview: {
        adviceId: string
        startDate: string
        endDate: string
        executableActions: number
        executedActions: number
        pendingActions: number
        executionRate: number
        buySide: {
          suggestedNotional: number
          executedNotional: number
          simulatedEndValue: number
          executedEndValue: number
          simulatedPnl: number
          executedPnl: number
          simulatedReturnPct: number | null
          executedReturnPct: number | null
        }
        sellSide: {
          suggestedNotional: number
          executedNotional: number
          suggestedCostBasis: number
          executedCostBasis: number
          simulatedRealizedPnl: number
          executedRealizedPnl: number
          simulatedRealizedReturnPct: number | null
          executedRealizedReturnPct: number | null
        }
        notes: string[]
      }
    } | null
    artifactRefs?: string[]
    trades?: Array<{ symbol: string; type: string; quantity: number; price: number }>
  }>(null)
  const [adviceDetail, setAdviceDetail] = useState<null | {
    adviceId: string
    summaryText?: string | null
    generatedAt: string
    scope?: string | null
    riskLevel: string
    executionReview?: {
      executionRate: number
      executableActions: number
      executedActions: number
      pendingActions: number
      suggestedNotional: number
      executedNotional: number
      buySide: {
        suggestedNotional: number
        executedNotional: number
        simulatedCurrentPnl: number
        executedCurrentPnl: number
      }
      sellSide: {
        suggestedNotional: number
        executedNotional: number
      }
      notes: string[]
    } | null
  }>(null)
  const [executionWindowReview, setExecutionWindowReview] = useState<null | {
    adviceId: string
    startDate: string
    endDate: string
    executableActions: number
    executedActions: number
    pendingActions: number
    executionRate: number
    buySide: {
      suggestedNotional: number
      executedNotional: number
      simulatedEndValue: number
      executedEndValue: number
      simulatedPnl: number
      executedPnl: number
      simulatedReturnPct: number | null
      executedReturnPct: number | null
    }
    sellSide: {
      suggestedNotional: number
      executedNotional: number
      suggestedCostBasis: number
      executedCostBasis: number
      simulatedRealizedPnl: number
      executedRealizedPnl: number
      simulatedRealizedReturnPct: number | null
      executedRealizedReturnPct: number | null
    }
    notes: string[]
  } | null>(null)
  const [portfolioBacktestLoading, setPortfolioBacktestLoading] = useState(false)
  const [portfolioTemplates, setPortfolioTemplates] = useState<any[]>([])
  const [portfolioTemplateError, setPortfolioTemplateError] = useState<string | null>(null)
  const [selectedPortfolioStrategyIds, setSelectedPortfolioStrategyIds] = useState<string[]>([])
  const [portfolioRuntimeHealth, setPortfolioRuntimeHealth] = useState<any | null>(null)
  const [portfolioBacktestResult, setPortfolioBacktestResult] = useState<any | null>(null)
  const [portfolioBacktestOperation, setPortfolioBacktestOperation] = useState<any | null>(null)
  const [portfolioBacktestParams, setPortfolioBacktestParams] = useState({
    userId: 'audit_portfolio_backtest_user',
    gradeMode: 'formal_review',
    startDate: '2025-12-04',
    endDate: DEFAULT_PORTFOLIO_BACKTEST_END_DATE,
    initialCapital: 100000,
  })

  useEffect(() => {
    let cancelled = false
    const fetchTemplates = async () => {
      try {
        const response = await axios.get('/api/v1/portfolio-backtest/templates')
        if (!cancelled) {
          const templates = response.data?.templates || []
          setPortfolioTemplates(templates)
          setSelectedPortfolioStrategyIds((previous) => {
            if (previous.length > 0) return previous
            const recommended = RECOMMENDED_PORTFOLIO_STRATEGY_IDS.filter((id) => templates.some((template: any) => template.strategyId === id))
            return recommended.length > 0
              ? recommended
              : templates.filter((template: any) => template.strategyId !== 'custom_weight_portfolio').slice(0, 3).map((template: any) => template.strategyId)
          })
          setPortfolioRuntimeHealth(response.data?.runtimeHealth || null)
          setPortfolioTemplateError(null)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch portfolio backtest templates:', error)
          setPortfolioTemplateError('组合模板加载失败，请检查后端服务或稍后重试。')
        }
      }
    }
    void fetchTemplates()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const view = params.get('view')
    if (view !== 'report' || !backtestResult || loadingResult) return

    const timer = window.setTimeout(() => {
      const target = document.getElementById('backtest-review-report')
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)

    return () => {
      window.clearTimeout(timer)
    }
  }, [location.search, backtestResult, loadingResult])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const adviceId = params.get('adviceId')
    const backtestId = params.get('backtestId')
    const operationId = params.get('operationId')
    if (adviceId) {
      form.setFieldValue('adviceId', adviceId)
    }
    if (operationId) {
      setBacktestOperation((previous) => previous ? { ...previous, id: operationId } : {
        id: operationId,
        status: 'running',
      })
    }
    if (backtestId) {
      setLatestRun((previous) => previous ? { ...previous, backtestId } : {
        backtestId,
        strategyId: '',
        adviceId: adviceId || '',
        status: 'running',
        symbols: [],
        startDate: '',
        endDate: '',
        initialCapital: 100000,
      })
    }
  }, [location.search, form])

  useEffect(() => {
    if (!backtestOperation?.id) return undefined
    if (backtestOperation.status === 'completed' || backtestOperation.status === 'failed' || backtestOperation.status === 'cancelled') {
      return undefined
    }

    let cancelled = false
    const fetchOperation = async () => {
      try {
        const response = await axios.get(`/api/v1/operations/${backtestOperation.id}`)
        if (cancelled) return
        setBacktestOperation(response.data)

        if (response.data?.status === 'completed' && response.data?.result?.backtestId) {
          setLatestRun({
            backtestId: response.data.result.backtestId,
            strategyId: response.data.result.strategyId,
            adviceId: response.data.result.adviceId,
            status: response.data.result.status || 'running',
            symbols: response.data.result.symbols || [],
            startDate: response.data.result.startDate || '',
            endDate: response.data.result.endDate || '',
            initialCapital: response.data.result.initialCapital || 100000,
          })
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch backtest operation:', error)
      }
    }

    void fetchOperation()
    const timer = window.setInterval(fetchOperation, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [backtestOperation?.id, backtestOperation?.status])

  useEffect(() => {
    const adviceId = form.getFieldValue('adviceId') || latestRun?.adviceId
    if (!adviceId) {
      setAdviceDetail(null)
      return
    }

    let cancelled = false
    const fetchAdviceDetail = async () => {
      setLoadingAdviceDetail(true)
      try {
        const response = await axios.get(`/api/v1/analysis/advice/${adviceId}`, {
          params: { userId: 'default' },
        })
        if (!cancelled) {
          setAdviceDetail(response.data)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch advice detail:', error)
          setAdviceDetail(null)
        }
      } finally {
        if (!cancelled) setLoadingAdviceDetail(false)
      }
    }

    void fetchAdviceDetail()
    return () => {
      cancelled = true
    }
  }, [form, latestRun?.adviceId, location.search])

  useEffect(() => {
    const adviceId = form.getFieldValue('adviceId') || latestRun?.adviceId
    const [start, end] = form.getFieldValue('range') || []
    const startDate = latestRun?.startDate || (start ? start.format('YYYY-MM-DD') : undefined)
    const endDate = latestRun?.endDate || (end ? end.format('YYYY-MM-DD') : undefined)

    if (!adviceId) {
      setExecutionWindowReview(null)
      return
    }

    let cancelled = false
    const fetchExecutionReview = async () => {
      setLoadingExecutionReview(true)
      try {
        const response = await axios.get('/api/v1/backtest/advice-execution-review', {
          params: {
            userId: 'default',
            adviceId,
            startDate,
            endDate,
          },
        })
        if (!cancelled) {
          setExecutionWindowReview(response.data || null)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch execution review:', error)
          setExecutionWindowReview(null)
        }
      } finally {
        if (!cancelled) setLoadingExecutionReview(false)
      }
    }

    void fetchExecutionReview()
    return () => {
      cancelled = true
    }
  }, [form, latestRun?.adviceId, latestRun?.startDate, latestRun?.endDate])

  useEffect(() => {
    if (!latestRun?.backtestId) return undefined

    let cancelled = false
    const fetchResult = async () => {
      setLoadingResult(true)
      try {
        const response = await axios.get(`/api/v1/backtest/results/${latestRun.backtestId}`)
        if (cancelled) return
        setBacktestResult(response.data)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch backtest result:', error)
      } finally {
        if (!cancelled) setLoadingResult(false)
      }
    }

    void fetchResult()

    if (backtestResult?.status === 'completed' || backtestResult?.status === 'failed') {
      return undefined
    }

    const timer = window.setInterval(fetchResult, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [latestRun?.backtestId, backtestResult?.status])

  const handleRunFromAdvice = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const [start, end] = values.range || []
      const response = await axios.post('/api/v1/operations/run-backtest', {
        userId: 'default',
        adviceId: values.adviceId,
        startDate: start ? start.format('YYYY-MM-DD') : undefined,
        endDate: end ? end.format('YYYY-MM-DD') : undefined,
        initialCapital: values.initialCapital,
      })
      setBacktestOperation(response.data)
      setBacktestResult(null)
      message.success(`回测任务已提交：${getOperationId(response.data)}`)
    } catch (error) {
      if ((error as any)?.errorFields) return
      console.error('Failed to run backtest from advice:', error)
      message.error('启动建议回测失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRunPortfolioBacktest = async () => {
    if (selectedPortfolioStrategyIds.length === 0) {
      message.warning('请至少选择一个组合策略')
      return
    }
    if (!portfolioBacktestParams.startDate || !portfolioBacktestParams.endDate) {
      message.warning('请选择回测日期区间')
      return
    }
    if (dayjs(portfolioBacktestParams.endDate).isBefore(dayjs(portfolioBacktestParams.startDate))) {
      message.warning('结束日期不能早于开始日期')
      return
    }
    setPortfolioBacktestLoading(true)
    try {
      const response = await axios.post('/api/v1/portfolio-backtest/run', {
        userId: portfolioBacktestParams.userId || 'default',
        portfolioStrategyIds: selectedPortfolioStrategyIds,
        startDate: portfolioBacktestParams.startDate,
        endDate: portfolioBacktestParams.endDate,
        initialCapital: portfolioBacktestParams.initialCapital,
        rebalanceFrequency: 'quarterly',
        dividendMode: 'reinvest',
        feeRate: 0.0003,
        slippageRate: 0.0005,
        benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20', 'free_source_total_return'],
        gradeMode: portfolioBacktestParams.gradeMode,
        executionMode: 'operation',
      })
      setPortfolioBacktestOperation(response.data?.operationId ? response.data : null)
      setPortfolioBacktestResult(response.data?.result || response.data)
      message.success(response.data?.result || response.data?.strategies ? '组合策略研究回测已生成结果' : '组合策略研究回测任务已提交')
      window.setTimeout(() => document.getElementById('portfolio-backtest-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    } catch (error) {
      console.error('Failed to run portfolio backtest:', error)
      const blocked = (error as any)?.response?.data
      if (blocked?.status === 'blocked') {
        setPortfolioBacktestOperation(blocked)
        setPortfolioBacktestResult(null)
        message.error('运行时健康未通过，已阻断持久化组合回测')
      } else {
        message.error('组合策略研究回测失败')
      }
    } finally {
      setPortfolioBacktestLoading(false)
    }
  }

  const executionComparison = useMemo(() => {
    if (backtestResult?.reviewReport?.windowReview) {
      const report = backtestResult.reviewReport.windowReview
      return {
        simulatedReturnPct: report.buySide.simulatedReturnPct,
        executedReturnPct: report.buySide.executedReturnPct,
        deltaPnl: report.buySide.executedPnl - report.buySide.simulatedPnl,
        review: report,
        display: {
          simulatedPnl: report.buySide.simulatedPnl,
          executedPnl: report.buySide.executedPnl,
          suggestedNotional: report.buySide.suggestedNotional,
          executedNotional: report.buySide.executedNotional,
        },
        sellDisplay: {
          simulatedRealizedReturnPct: report.sellSide.simulatedRealizedReturnPct,
          executedRealizedReturnPct: report.sellSide.executedRealizedReturnPct,
          simulatedRealizedPnl: report.sellSide.simulatedRealizedPnl,
          executedRealizedPnl: report.sellSide.executedRealizedPnl,
          suggestedNotional: report.sellSide.suggestedNotional,
          executedNotional: report.sellSide.executedNotional,
          suggestedCostBasis: report.sellSide.suggestedCostBasis,
          executedCostBasis: report.sellSide.executedCostBasis,
        },
        periodMode: 'persisted' as const,
      }
    }

    if (executionWindowReview) {
      return {
        simulatedReturnPct: executionWindowReview.buySide.simulatedReturnPct,
        executedReturnPct: executionWindowReview.buySide.executedReturnPct,
        deltaPnl: executionWindowReview.buySide.executedPnl - executionWindowReview.buySide.simulatedPnl,
        review: executionWindowReview,
        display: {
          simulatedPnl: executionWindowReview.buySide.simulatedPnl,
          executedPnl: executionWindowReview.buySide.executedPnl,
          suggestedNotional: executionWindowReview.buySide.suggestedNotional,
          executedNotional: executionWindowReview.buySide.executedNotional,
        },
        sellDisplay: {
          simulatedRealizedReturnPct: executionWindowReview.sellSide.simulatedRealizedReturnPct,
          executedRealizedReturnPct: executionWindowReview.sellSide.executedRealizedReturnPct,
          simulatedRealizedPnl: executionWindowReview.sellSide.simulatedRealizedPnl,
          executedRealizedPnl: executionWindowReview.sellSide.executedRealizedPnl,
          suggestedNotional: executionWindowReview.sellSide.suggestedNotional,
          executedNotional: executionWindowReview.sellSide.executedNotional,
          suggestedCostBasis: executionWindowReview.sellSide.suggestedCostBasis,
          executedCostBasis: executionWindowReview.sellSide.executedCostBasis,
        },
        periodMode: 'window' as const,
      }
    }

    if (!adviceDetail?.executionReview) return null

    const review = adviceDetail.executionReview
    const simulatedReturnPct = review.buySide.suggestedNotional > 0
      ? (review.buySide.simulatedCurrentPnl / review.buySide.suggestedNotional) * 100
      : null
    const executedReturnPct = review.buySide.executedNotional > 0
      ? (review.buySide.executedCurrentPnl / review.buySide.executedNotional) * 100
      : null

    return {
      simulatedReturnPct,
      executedReturnPct,
      deltaPnl: review.buySide.executedCurrentPnl - review.buySide.simulatedCurrentPnl,
      review,
      display: {
        simulatedPnl: review.buySide.simulatedCurrentPnl,
        executedPnl: review.buySide.executedCurrentPnl,
        suggestedNotional: review.buySide.suggestedNotional,
        executedNotional: review.buySide.executedNotional,
      },
      sellDisplay: {
        simulatedRealizedReturnPct: null,
        executedRealizedReturnPct: null,
        simulatedRealizedPnl: 0,
        executedRealizedPnl: 0,
        suggestedNotional: review.sellSide.suggestedNotional,
        executedNotional: review.sellSide.executedNotional,
        suggestedCostBasis: 0,
        executedCostBasis: 0,
      },
      periodMode: 'snapshot' as const,
    }
  }, [adviceDetail, executionWindowReview, backtestResult])

  const selectedTemplates = useMemo(() => {
    const map = new Map(portfolioTemplates.map((template) => [template.strategyId, template]))
    return selectedPortfolioStrategyIds.map((id) => map.get(id)).filter(Boolean)
  }, [portfolioTemplates, selectedPortfolioStrategyIds])

  const portfolioDataCutoffDate = useMemo(() => {
    const snapshotDates = [
      ...portfolioTemplates.map((template) => template.snapshot?.tradeDate),
      ...(portfolioBacktestResult?.strategies || []).map((strategy: any) => strategy.definition?.snapshot?.tradeDate),
    ].filter(Boolean).sort()
    return snapshotDates[snapshotDates.length - 1] || DEFAULT_PORTFOLIO_BACKTEST_END_DATE
  }, [portfolioTemplates, portfolioBacktestResult])

  const applyQuickPortfolioRange = (months: number) => {
    const end = dayjs(portfolioDataCutoffDate)
    setPortfolioBacktestParams((previous) => ({
      ...previous,
      startDate: end.subtract(months, 'month').format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
    }))
  }

  const portfolioGateSummary = useMemo(() => {
    if (!portfolioBacktestResult) {
      return {
        status: '待运行',
        color: '#64748b',
        description: '选择组合策略和时间区间后运行回测；本页只生成研究比较结果。',
      }
    }
    const unlocked = portfolioBacktestResult.formalTradingUnlockChecklist?.formalTradingUnlocked === true
    const blockers = portfolioBacktestResult.formalTradingUnlockChecklist?.blockers || portfolioBacktestResult.formalReviewReadiness?.blockers || []
    return {
      status: unlocked ? '正式交易已解锁' : '正式交易未解锁',
      color: unlocked ? '#34d399' : '#ef4444',
      description: unlocked
        ? '正式交易 gate 已满足，但 AUTO_TRADE 仍需要单独人工治理。'
        : `当前只能用于研究比较和计划草案。阻断原因：${blockers.slice(0, 4).join('、') || '人工确认、模型有效性或正式数据审计未完成'}`,
    }
  }, [portfolioBacktestResult])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">策略回测</h1>
      <Card title={<span className="text-primary">组合策略对比回测</span>} className="bg-[#1a1a2e] border-surface-border">
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="研究回测，不构成交易指令"
          description="当前用于真实数据组合策略比较和正式评审前置；ADD、REDUCE、ORDER_CREATE、AUTO_TRADE 仍被禁止。免费源 total-return 只能支持 formal-review-ready，不等同官方授权正式交易数据。"
        />

        <div className="mb-4 rounded-lg border border-white/10 bg-[#0f172a99] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-white">1. 选择要比较的组合策略</div>
              <div className="text-xs text-gray-400">默认只选推荐组合；取消勾选后，请求体会只提交当前选中的策略。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="small" onClick={() => setSelectedPortfolioStrategyIds(portfolioTemplates.filter((item) => item.strategyId !== 'custom_weight_portfolio').map((item) => item.strategyId))}>全选</Button>
              <Button size="small" onClick={() => setSelectedPortfolioStrategyIds(RECOMMENDED_PORTFOLIO_STRATEGY_IDS.filter((id) => portfolioTemplates.some((item) => item.strategyId === id)))}>推荐 3 组</Button>
              <Button size="small" onClick={() => setSelectedPortfolioStrategyIds(['dividend_low_vol_basket', 'current_holdings_buy_and_hold'].filter((id) => portfolioTemplates.some((item) => item.strategyId === id)))}>红利+当前持仓</Button>
              <Button size="small" onClick={() => setSelectedPortfolioStrategyIds([])}>清空</Button>
            </div>
          </div>
          {portfolioTemplateError && (
            <Alert className="mb-3" type="error" showIcon message={portfolioTemplateError} action={<Button size="small" onClick={() => window.location.reload()}>重试</Button>} />
          )}
          <Checkbox.Group
            className="w-full"
            value={selectedPortfolioStrategyIds}
            onChange={(values) => setSelectedPortfolioStrategyIds(values.map(String))}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {portfolioTemplates.map((template) => (
                <label key={template.strategyId} className="block rounded-lg border border-white/10 bg-black/10 p-3 hover:border-sky-400/60">
                  <div className="flex items-start gap-2">
                    <Checkbox value={template.strategyId} disabled={template.strategyId === 'custom_weight_portfolio'} />
                    <div className="min-w-0">
                      <div className="font-medium text-white">{template.displayName}</div>
                      <div className="mt-1 line-clamp-3 text-xs leading-5 text-gray-400">{template.description}</div>
                      {template.strategyId === 'custom_weight_portfolio' && <Tag className="mt-2" color="#64748b">暂未开放输入</Tag>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Checkbox.Group>
        </div>

        <div className="grid gap-3 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <div className="mb-1 text-xs text-gray-400">用户</div>
            <Input
              value={portfolioBacktestParams.userId}
              onChange={(event) => setPortfolioBacktestParams((previous) => ({ ...previous, userId: event.target.value }))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">验收模式</div>
            <Select
              className="w-full"
              value={portfolioBacktestParams.gradeMode}
              onChange={(value) => setPortfolioBacktestParams((previous) => ({ ...previous, gradeMode: value }))}
              options={[
                { value: 'formal_review', label: '正式评审前置' },
                { value: 'research', label: '研究模式' },
              ]}
            />
          </div>
          <div className="lg:col-span-2">
            <div className="mb-1 text-xs text-gray-400">回测区间</div>
            <RangePicker
              className="w-full"
              value={portfolioBacktestParams.startDate && portfolioBacktestParams.endDate
                ? [dayjs(portfolioBacktestParams.startDate), dayjs(portfolioBacktestParams.endDate)]
                : null}
              onChange={(range) => setPortfolioBacktestParams((previous) => ({
                ...previous,
                startDate: range?.[0]?.format('YYYY-MM-DD') || '',
                endDate: range?.[1]?.format('YYYY-MM-DD') || '',
              }))}
            />
            <div className="mt-1 text-[11px] text-gray-500">数据可用截止日：{portfolioDataCutoffDate}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {[
                ['近 6 月', 6],
                ['近 1 年', 12],
                ['近 3 年', 36],
              ].map(([label, months]) => (
                <Button
                  key={String(label)}
                  size="small"
                  onClick={() => applyQuickPortfolioRange(Number(months))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">初始资金</div>
            <InputNumber
              min={1000}
              step={1000}
              value={portfolioBacktestParams.initialCapital}
              onChange={(value) => setPortfolioBacktestParams((previous) => ({ ...previous, initialCapital: Number(value || 100000) }))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="lg:col-span-6 flex flex-wrap items-end gap-2">
            <Button type="primary" loading={portfolioBacktestLoading} onClick={handleRunPortfolioBacktest}>
              运行组合回测
            </Button>
            {portfolioBacktestOperation?.operationId && (
              <Button onClick={() => navigate(`/operations?operationId=${portfolioBacktestOperation.operationId}`)}>
                查看任务产物
              </Button>
            )}
            <Tag color="#64748b">模板 {portfolioTemplates.length}</Tag>
            <Tag color={selectedPortfolioStrategyIds.length > 0 ? '#38bdf8' : '#ef4444'}>已选 {selectedPortfolioStrategyIds.length}</Tag>
            <Tag color="#38bdf8">Benchmark: free_source_total_return</Tag>
            {portfolioBacktestOperation?.artifactRefs?.length > 0 && (
              <Tag color="#a78bfa">产物 {portfolioBacktestOperation.artifactRefs.length}</Tag>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
          <div className="mb-2 flex flex-wrap gap-2">
            <Tag color="#38bdf8">将运行 {selectedTemplates.length} 个策略</Tag>
            <Tag color={portfolioBacktestParams.startDate && portfolioBacktestParams.endDate ? '#64748b' : '#ef4444'}>
              区间 {portfolioBacktestParams.startDate || '未选'} ~ {portfolioBacktestParams.endDate || '未选'}
            </Tag>
            <Tag color="#64748b">分红 reinvest</Tag>
            <Tag color="#64748b">季度再平衡</Tag>
            <Tag color="#64748b">费率 0.03% / 滑点 0.05%</Tag>
          </div>
          <div className="text-gray-400">
            {selectedTemplates.map((template) => template.displayName).join('、') || '尚未选择策略'}
          </div>
        </div>
        {portfolioRuntimeHealth && (
          <div className="mt-4 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Tag color={portfolioRuntimeHealth.status === 'healthy' ? '#34d399' : '#ef4444'}>
                Runtime {portfolioRuntimeHealth.status}
              </Tag>
              <Tag color={portfolioRuntimeHealth.sqliteHealthy ? '#34d399' : '#ef4444'}>
                SQLite {portfolioRuntimeHealth.sqliteHealthy ? 'healthy' : 'critical'}
              </Tag>
              <Tag color={portfolioRuntimeHealth.decision?.largeBacktestPersistenceAllowed ? '#34d399' : '#fbbf24'}>
                Operation 持久化 {portfolioRuntimeHealth.decision?.largeBacktestPersistenceAllowed ? '允许' : '阻断'}
              </Tag>
            </div>
            <div className="text-gray-300">
              {portfolioRuntimeHealth.decision?.reason || '运行时健康由后端统一闸门判断。'}
            </div>
          </div>
        )}
        {portfolioBacktestOperation?.status === 'blocked' && (
          <div className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            组合回测 Operation 已被运行时健康闸门阻断：
            {(portfolioBacktestOperation.blockedReasons || []).join(', ') || 'runtime health blocked'}。
            当前只能进行非持久化研究或修复数据库健康后重试。
          </div>
        )}
        {portfolioTemplates.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-400">
            <span>可用模板：</span>
            {portfolioTemplates.map((template) => <Tag key={template.strategyId} color="#64748b">{template.displayName}</Tag>)}
          </div>
        )}
        {portfolioBacktestResult && (
          <div id="portfolio-backtest-result" className="mt-5 space-y-4">
            <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Tag color={portfolioGateSummary.color}>{portfolioGateSummary.status}</Tag>
                <Tag color="#38bdf8">允许 RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT</Tag>
                <Tag color="#ef4444">禁止 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE</Tag>
              </div>
              <div className="text-sm text-gray-300">{portfolioGateSummary.description}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tag color="#34d399">{portfolioBacktestResult.schemaVersion}</Tag>
              <Tag color={portfolioBacktestResult.formalReviewReadiness?.ready ? '#34d399' : '#ef4444'}>
                formal-review {portfolioBacktestResult.formalReviewReadiness?.ready ? 'ready' : 'blocked'}
              </Tag>
              <Tag color={portfolioBacktestResult.dataGradeAudit?.status === 'passed' ? '#34d399' : '#fbbf24'}>
                数据等级 {portfolioBacktestResult.dataGradeAudit?.aggregateGrade || 'unknown'}
              </Tag>
              <Tag color={portfolioBacktestResult.modelEffectiveness?.status === 'passed' ? '#34d399' : portfolioBacktestResult.modelEffectiveness?.status === 'failed' ? '#ef4444' : '#fbbf24'}>
                模型有效性 {portfolioBacktestResult.modelEffectiveness?.status || 'unknown'}
              </Tag>
              <Tag color={portfolioBacktestResult.formalTradingUnlockChecklist?.formalTradingUnlocked ? '#34d399' : '#ef4444'}>
                正式交易 {portfolioBacktestResult.formalTradingUnlockChecklist?.formalTradingUnlocked ? '已解锁' : '未解锁'}
              </Tag>
              {portfolioBacktestResult.allowedActions?.map((action: string) => <Tag key={action} color="#38bdf8">{action}</Tag>)}
              {portfolioBacktestResult.prohibitedActions?.map((action: string) => <Tag key={action} color="#ef4444">禁止 {action}</Tag>)}
              <Tag color={portfolioBacktestResult.notTradingAdvice ? '#fbbf24' : '#ef4444'}>
                {portfolioBacktestResult.notTradingAdvice ? '非交易建议' : '风险：交易建议标记异常'}
              </Tag>
            </div>
            {portfolioBacktestResult.formalReviewReadiness && (
              <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-sm">
                <div className="mb-2 flex flex-wrap gap-2">
                  <Tag color={portfolioBacktestResult.formalReviewReadiness.status === 'passed' ? '#34d399' : '#ef4444'}>
                    Formal Review {portfolioBacktestResult.formalReviewReadiness.status}
                  </Tag>
                  <Tag color={portfolioBacktestResult.formalReviewReadiness.tradeConstraintCoverage?.status === 'passed' ? '#34d399' : '#ef4444'}>
                    交易约束 {portfolioBacktestResult.formalReviewReadiness.tradeConstraintCoverage?.coveragePercent ?? 0}%
                  </Tag>
                  <Tag color={portfolioBacktestResult.formalReviewReadiness.dividendReturnCoverage?.status === 'passed' ? '#34d399' : '#ef4444'}>
                    分红覆盖 {portfolioBacktestResult.formalReviewReadiness.dividendReturnCoverage?.coveragePercent ?? 0}%
                  </Tag>
                </div>
                <div className="text-gray-300">
                  Benchmark 状态：{Object.entries(portfolioBacktestResult.formalReviewReadiness.benchmarkStatuses || {}).map(([id, status]) => `${id}=${status}`).join('；') || '--'}
                </div>
                {(portfolioBacktestResult.formalReviewReadiness.blockers || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {portfolioBacktestResult.formalReviewReadiness.blockers.map((blocker: string) => <Tag key={blocker} color="#ef4444">{blocker}</Tag>)}
                  </div>
                )}
              </div>
            )}
            {portfolioBacktestResult.formalTradingUnlockChecklist && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm">
                <div className="mb-2 flex flex-wrap gap-2">
                  <Tag color="#ef4444">正式交易解锁清单 {portfolioBacktestResult.formalTradingUnlockChecklist.status}</Tag>
                  <Tag color={portfolioBacktestResult.formalTradingUnlockChecklist.modelEffectivenessReviewed ? '#34d399' : '#fbbf24'}>
                    模型复核 {portfolioBacktestResult.formalTradingUnlockChecklist.modelEffectivenessReviewed ? '通过' : '未通过'}
                  </Tag>
                  <Tag color={portfolioBacktestResult.formalTradingUnlockChecklist.tradeConstraintsReviewed ? '#34d399' : '#fbbf24'}>
                    交易约束 {portfolioBacktestResult.formalTradingUnlockChecklist.tradeConstraintsReviewed ? '通过' : '未通过'}
                  </Tag>
                  <Tag color={portfolioBacktestResult.formalTradingUnlockChecklist.humanReviewerConfirmed ? '#34d399' : '#ef4444'}>
                    人工确认 {portfolioBacktestResult.formalTradingUnlockChecklist.humanReviewerConfirmed ? '完成' : '未完成'}
                  </Tag>
                  <Tag color="#ef4444">AUTO_TRADE 禁止</Tag>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(portfolioBacktestResult.formalTradingUnlockChecklist.blockers || []).map((blocker: string) => (
                    <Tag key={blocker} color="#ef4444">{blocker}</Tag>
                  ))}
                </div>
              </div>
            )}
            <PortfolioCurveChart strategies={portfolioBacktestResult.strategies || []} />
            <div className="grid gap-3 xl:grid-cols-3">
              {(portfolioBacktestResult.strategies || []).map((strategy: any) => (
                <div key={strategy.definition?.strategyId} className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-white">{strategy.definition?.displayName || strategy.definition?.strategyId}</div>
                    <Tag color={strategy.status === 'completed' ? '#34d399' : strategy.status === 'partial' ? '#fbbf24' : '#ef4444'}>{strategy.status}</Tag>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-gray-400">总收益</div>
                    <div className="text-right text-white">{formatPercent(strategy.metrics?.totalReturnPercent)}</div>
                    <div className="text-gray-400">价格收益</div>
                    <div className="text-right text-white">{strategy.metrics?.priceOnlyReturnPercent == null ? '--' : formatPercent(strategy.metrics.priceOnlyReturnPercent)}</div>
                    <div className="text-gray-400">年化</div>
                    <div className="text-right text-white">{formatPercent(strategy.metrics?.annualizedReturnPercent)}</div>
                    <div className="text-gray-400">最大回撤</div>
                    <div className="text-right text-white">{formatPercent(strategy.metrics?.maxDrawdownPercent)}</div>
                    <div className="text-gray-400">夏普</div>
                    <div className="text-right text-white">{strategy.metrics?.sharpe == null ? '--' : strategy.metrics.sharpe.toFixed(2)}</div>
                    <div className="text-gray-400">价格覆盖</div>
                    <div className="text-right text-white">{formatPercent(strategy.dataCoverage?.priceCoveragePercent)}</div>
                    <div className="text-gray-400">分红贡献</div>
                    <div className="text-right text-white">{strategy.metrics?.dividendContributionPercent == null ? '--' : formatPercent(strategy.metrics.dividendContributionPercent)}</div>
                    <div className="text-gray-400">成本拖累</div>
                    <div className="text-right text-white">{strategy.metrics?.costDragPercent == null ? '--' : formatPercent(-strategy.metrics.costDragPercent)}</div>
                    <div className="text-gray-400">Benchmark</div>
                    <div className="text-right text-white">{strategy.metrics?.benchmarkReturnPercent == null ? '--' : formatPercent(strategy.metrics.benchmarkReturnPercent)}</div>
                    <div className="text-gray-400">超额收益</div>
                    <div className="text-right text-white">{strategy.metrics?.excessReturnPercent == null ? '--' : formatPercent(strategy.metrics.excessReturnPercent)}</div>
                    <div className="text-gray-400">Formal Review</div>
                    <div className="text-right text-white">{strategy.formalReviewReadiness?.status || '--'}</div>
                    <div className="text-gray-400">数据等级</div>
                    <div className="text-right text-white">{strategy.dataGradeAudit?.aggregateGrade || '--'}</div>
                    <div className="text-gray-400">模型有效性</div>
                    <div className="text-right text-white">{strategy.modelEffectiveness?.status || '--'}</div>
                    <div className="text-gray-400">草案</div>
                    <div className="text-right text-white">{strategy.manualPlanDraft?.status || '--'}</div>
                    <div className="text-gray-400">正式目标仓位</div>
                    <div className="text-right text-white">{strategy.manualPlanDraft?.formalTargetWeightPercent ?? 0}%</div>
                  </div>
                  {strategy.manualPlanDraft && (
                    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-xs text-gray-300">
                      <div className="mb-1 flex flex-wrap gap-1">
                        {(strategy.manualPlanDraft.suggestedActionTypes || []).map((action: string) => (
                          <Tag key={action} color="#38bdf8">{action}</Tag>
                        ))}
                        <Tag color="#ef4444">formalTargetWeight 0%</Tag>
                      </div>
                      {(strategy.manualPlanDraft.blockedReasons || []).slice(0, 8).map((reason: string) => (
                        <Tag key={reason} color="#ef4444">{reason}</Tag>
                      ))}
                    </div>
                  )}
                  {strategy.modelEffectiveness?.failureTaxonomy?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {strategy.modelEffectiveness.failureTaxonomy.slice(0, 8).map((reason: string) => <Tag key={reason} color="#fbbf24">{reason}</Tag>)}
                    </div>
                  )}
                  {(strategy.blockedReasons || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {strategy.blockedReasons.map((reason: string) => <Tag key={reason} color="#ef4444">{reason}</Tag>)}
                    </div>
                  )}
                  {strategy.definition?.snapshot && (
                    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-xs text-gray-300">
                      <div>快照来源：{strategy.definition.snapshot.source}</div>
                      {strategy.definition.snapshot.tradeDate && <div>交易日：{strategy.definition.snapshot.tradeDate}</div>}
                      {strategy.definition.snapshot.selectedCandidateCount != null && (
                        <div>入篮标的：{strategy.definition.snapshot.selectedCandidateCount} / 候选 {strategy.definition.snapshot.candidateCount ?? '--'}</div>
                      )}
                      {strategy.definition?.strategyId === 'dividend_low_vol_basket'
                        && (strategy.definition.snapshot.selectedCandidateCount ?? 0) < 3 && (
                        <div className="mt-1 text-yellow-200">
                          当前红利低波入篮数量低于最小 3 只要求，保持 insufficient，不展示完成曲线。
                        </div>
                      )}
                      {strategy.definition.snapshot.weightPolicy && <div>权重规则：{strategy.definition.snapshot.weightPolicy}</div>}
                      {Array.isArray(strategy.definition.snapshot.evidenceRefs) && (
                        <div>证据引用：{strategy.definition.snapshot.evidenceRefs.length} 条</div>
                      )}
                    </div>
                  )}
                  {(strategy.warnings || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {strategy.warnings.map((warning: string) => <Tag key={warning} color="#fbbf24">{warning}</Tag>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Card title={<span className="text-primary">基于建议发起回测</span>} className="bg-[#1a1a2e] border-surface-border">
        <Form form={form} layout="vertical" className="grid gap-4 lg:grid-cols-4">
          <Form.Item name="adviceId" label="Advice ID" rules={[{ required: true, message: '请输入 adviceId' }]} className="lg:col-span-2 mb-0">
            <Input placeholder="输入建议 ID，或从任务中心跳转预填" />
          </Form.Item>
          <Form.Item name="initialCapital" label="初始资金" initialValue={100000} className="mb-0">
            <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="操作" className="mb-0 flex items-end">
            <Button type="primary" onClick={handleRunFromAdvice} loading={submitting}>
              启动回测
            </Button>
          </Form.Item>
          <Form.Item name="range" label="回测区间" className="lg:col-span-2 mb-0">
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>

        {latestRun && (
          <div className="mt-4 rounded-lg border border-white/10 bg-[#0f172a99] p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <Tag color="#34d399">{latestRun.status}</Tag>
              <Tag color="#818cf8">Backtest {latestRun.backtestId.slice(0, 8)}</Tag>
              <Tag color="#a78bfa">Strategy {latestRun.strategyId.slice(0, 8)}</Tag>
              <Tag color="#38bdf8">Advice {latestRun.adviceId.slice(0, 8)}</Tag>
            </div>
            <div className="text-sm text-gray-300">
              标的 {latestRun.symbols.join(', ')} · 区间 {latestRun.startDate} ~ {latestRun.endDate} · 初始资金 {latestRun.initialCapital}
            </div>
          </div>
        )}

        {backtestOperation && !latestRun && (
          <div className="mt-4 rounded-lg border border-white/10 bg-[#0f172a99] p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <Tag color={backtestOperation.status === 'failed' ? '#f87171' : backtestOperation.status === 'completed' ? '#34d399' : '#818cf8'}>
                {backtestOperation.status}
              </Tag>
              <Tag color="#38bdf8">Operation {backtestOperation.id.slice(0, 8)}</Tag>
              {typeof backtestOperation.progressPct === 'number' && (
                <Tag color="#a78bfa">进度 {backtestOperation.progressPct}%</Tag>
              )}
            </div>
            <div className="text-sm text-gray-300">
              正在创建回测任务并接入任务中心。
              {backtestOperation.error?.message ? ` 错误：${backtestOperation.error.message}` : ''}
            </div>
          </div>
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            id="backtest-review-report"
            title={<span className="text-primary">建议模拟 vs 实际执行</span>}
            extra={adviceDetail?.adviceId ? (
              <Button size="small" type="link" onClick={() => navigate('/operations')}>
                查看任务中心
              </Button>
            ) : undefined}
            className="bg-[#1a1a2e] border-surface-border"
          >
            {loadingAdviceDetail ? (
              <div className="text-gray-400">建议详情加载中...</div>
            ) : !executionComparison ? (
              <div className="text-gray-500">等待 advice 复盘数据</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Tag color="#a78bfa">Advice {adviceDetail?.adviceId.slice(0, 8)}</Tag>
                  <Tag color="#38bdf8">{adviceDetail?.scope || 'portfolio'}</Tag>
                  <Tag color={adviceDetail?.riskLevel === 'high' ? '#f87171' : adviceDetail?.riskLevel === 'medium' ? '#fbbf24' : '#34d399'}>
                    风险 {adviceDetail?.riskLevel}
                  </Tag>
                  <Tag color="#34d399">
                    执行率 {(executionComparison.review.executionRate * 100).toFixed(0)}%
                  </Tag>
                  <Tag color={executionComparison.periodMode === 'persisted' ? '#a78bfa' : executionComparison.periodMode === 'window' ? '#38bdf8' : '#64748b'}>
                    {executionComparison.periodMode === 'persisted' ? '持久化报告' : executionComparison.periodMode === 'window' ? '区间口径' : '静态口径'}
                  </Tag>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                    <div className="text-xs text-gray-400 mb-2">建议模拟收益</div>
                    <div className="text-2xl text-white">
                      {executionComparison.simulatedReturnPct === null ? '--' : formatPercent(executionComparison.simulatedReturnPct)}
                    </div>
                    <div
                      className="text-sm mt-2"
                      style={{ color: executionComparison.display.simulatedPnl >= 0 ? '#34d399' : '#f87171' }}
                    >
                      {formatSignedMoney(executionComparison.display.simulatedPnl)}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      建议金额 {formatMoney(executionComparison.display.suggestedNotional)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                    <div className="text-xs text-gray-400 mb-2">实际执行收益</div>
                    <div className="text-2xl text-white">
                      {executionComparison.executedReturnPct === null ? '--' : formatPercent(executionComparison.executedReturnPct)}
                    </div>
                    <div
                      className="text-sm mt-2"
                      style={{ color: executionComparison.display.executedPnl >= 0 ? '#34d399' : '#f87171' }}
                    >
                      {formatSignedMoney(executionComparison.display.executedPnl)}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      已执行金额 {formatMoney(executionComparison.display.executedNotional)}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                  <div className="text-xs text-gray-400 mb-2">执行偏差</div>
                  <div
                    className="text-2xl font-semibold"
                    style={{ color: executionComparison.deltaPnl >= 0 ? '#34d399' : '#f87171' }}
                  >
                    {formatSignedMoney(executionComparison.deltaPnl)}
                  </div>
                  <div className="text-xs text-gray-300 mt-2">
                    含义：实际执行浮盈亏减去建议模拟浮盈亏。正值表示实际执行优于完全按建议买入持有。
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                    <div className="text-xs text-gray-400">可执行动作</div>
                    <div className="text-lg text-white mt-1">{executionComparison.review.executableActions}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                    <div className="text-xs text-gray-400">已执行动作</div>
                    <div className="text-lg text-white mt-1">{executionComparison.review.executedActions}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                    <div className="text-xs text-gray-400">待执行动作</div>
                    <div className="text-lg text-white mt-1">{executionComparison.review.pendingActions}</div>
                  </div>
                </div>

                {(executionComparison.sellDisplay.suggestedNotional || executionComparison.sellDisplay.executedNotional) ? (
                  <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                    <div className="text-xs text-gray-400 mb-3">卖出类已实现收益对比</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                        <div className="text-xs text-gray-400 mb-2">建议模拟卖出</div>
                        <div className="text-2xl text-white">
                          {executionComparison.sellDisplay.simulatedRealizedReturnPct === null
                            ? '--'
                            : formatPercent(executionComparison.sellDisplay.simulatedRealizedReturnPct)}
                        </div>
                        <div
                          className="text-sm mt-2"
                          style={{ color: executionComparison.sellDisplay.simulatedRealizedPnl >= 0 ? '#34d399' : '#f87171' }}
                        >
                          {formatSignedMoney(executionComparison.sellDisplay.simulatedRealizedPnl)}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                          卖出金额 {formatMoney(executionComparison.sellDisplay.suggestedNotional)} · 成本 {formatMoney(executionComparison.sellDisplay.suggestedCostBasis)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                        <div className="text-xs text-gray-400 mb-2">实际执行卖出</div>
                        <div className="text-2xl text-white">
                          {executionComparison.sellDisplay.executedRealizedReturnPct === null
                            ? '--'
                            : formatPercent(executionComparison.sellDisplay.executedRealizedReturnPct)}
                        </div>
                        <div
                          className="text-sm mt-2"
                          style={{ color: executionComparison.sellDisplay.executedRealizedPnl >= 0 ? '#34d399' : '#f87171' }}
                        >
                          {formatSignedMoney(executionComparison.sellDisplay.executedRealizedPnl)}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                          卖出金额 {formatMoney(executionComparison.sellDisplay.executedNotional)} · 成本 {formatMoney(executionComparison.sellDisplay.executedCostBasis)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {executionComparison.review.notes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {executionComparison.review.notes.map((note) => (
                      <Tag key={note} color="#64748b">{note}</Tag>
                    ))}
                  </div>
                )}
                {Array.isArray(backtestResult?.artifactRefs) && backtestResult.artifactRefs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {backtestResult.artifactRefs.map((ref) => (
                      <Tag key={ref} color="#475569">{ref}</Tag>
                    ))}
                  </div>
                )}
                {loadingExecutionReview && (
                  <div className="text-xs text-gray-400">区间复盘更新中...</div>
                )}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span className="text-primary">回测结果对照</span>} className="bg-[#1a1a2e] border-surface-border">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                <div className="text-xs text-gray-400 mb-2">建议回测总收益率</div>
                <div className="text-2xl text-white">
                  {backtestResult?.metrics?.totalReturn === undefined || backtestResult?.metrics?.totalReturn === null
                    ? '--'
                    : formatPercent(backtestResult.metrics.totalReturn)}
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  年化 {backtestResult?.metrics?.annualizedReturn === undefined || backtestResult?.metrics?.annualizedReturn === null
                    ? '--'
                    : formatPercent(backtestResult.metrics.annualizedReturn)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                <div className="text-xs text-gray-400 mb-2">当前实际执行收益率</div>
                <div className="text-2xl text-white">
                  {executionComparison?.executedReturnPct === null || executionComparison?.executedReturnPct === undefined
                    ? '--'
                    : formatPercent(executionComparison.executedReturnPct)}
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  当前价格静态估算
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-4 leading-6">
              回测结果代表“完全按建议快照执行”的模拟表现；实际执行收益优先使用同一回测区间的结束日价格估算，拿不到区间数据时才回退到当前静态估算。当前主要用于快速复盘偏差，不替代正式月度回测报告。
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title={<span className="text-primary">建议回测交易记录</span>} className="bg-[#1a1a2e] border-surface-border">
            <div className="h-80 overflow-auto rounded-lg border border-white/10 bg-[#0f172a99] p-4">
              {loadingResult ? (
                <div className="h-full flex items-center justify-center text-gray-400">回测结果加载中...</div>
              ) : backtestResult?.trades && backtestResult.trades.length > 0 ? (
                <div className="space-y-3">
                  {backtestResult.trades.slice(0, 12).map((trade, index) => (
                    <div key={`${trade.symbol}-${index}`} className="flex items-center justify-between border-b border-white/10 pb-2 text-sm">
                      <div className="text-white">{trade.symbol}</div>
                      <div className="text-gray-300">{trade.type}</div>
                      <div className="text-gray-300">{trade.quantity}</div>
                      <div className="text-gray-300">{trade.price.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  {backtestResult ? '暂无交易记录；当前接口未返回建议回测权益曲线' : '等待回测结果'}
                </div>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span className="text-primary">回测指标</span>} className="bg-[#1a1a2e] border-surface-border">
            <div className="space-y-4">
              <div className="text-gray-300">年化收益率</div>
              <div className="text-2xl text-success">{backtestResult?.metrics?.annualizedReturn?.toFixed(2) ?? '--'}%</div>
              <div className="text-gray-300">夏普比率</div>
              <div className="text-2xl text-white">{backtestResult?.metrics?.sharpeRatio?.toFixed(2) ?? '--'}</div>
              <div className="text-gray-300">最大回撤</div>
              <div className="text-2xl text-danger">-{backtestResult?.metrics?.maxDrawdown?.toFixed(2) ?? '--'}%</div>
              <div className="text-gray-300">总收益率</div>
              <div className="text-2xl text-white">{backtestResult?.metrics?.totalReturn?.toFixed(2) ?? '--'}%</div>
              <div className="text-gray-300">交易次数</div>
              <div className="text-2xl text-white">{backtestResult?.metrics?.tradesCount ?? '--'}</div>
              <div className="text-gray-300">状态</div>
              <div className="text-lg text-white">{backtestResult?.status || latestRun?.status || '--'} {typeof backtestResult?.progress === 'number' ? `(${backtestResult.progress}%)` : ''}</div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Backtest
