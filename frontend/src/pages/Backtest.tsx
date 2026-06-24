import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Tag, message } from 'antd'
import axios from 'axios'
import { useLocation, useNavigate } from 'react-router-dom'

const { RangePicker } = DatePicker

const formatMoney = (value?: number | null) => `¥${(value || 0).toFixed(2)}`
const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`
const formatSignedMoney = (value?: number | null) => {
  const amount = value || 0
  return `${amount >= 0 ? '+' : '-'}¥${Math.abs(amount).toFixed(2)}`
}
const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id

const PortfolioCurveChart: React.FC<{ strategies: any[] }> = ({ strategies }) => {
  const completed = strategies.filter((strategy) => Array.isArray(strategy.equityCurve) && strategy.equityCurve.length > 1)
  if (completed.length === 0) {
    return <div className="h-56 flex items-center justify-center text-gray-500">暂无可绘制曲线</div>
  }
  const colors = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#fb7185']
  const allValues = completed.flatMap((strategy) => strategy.equityCurve.map((point: any) => Number(point.netValue || 1)))
  const min = Math.min(...allValues, 0.9)
  const max = Math.max(...allValues, 1.1)
  const span = Math.max(0.01, max - min)
  const width = 760
  const height = 220
  const toPath = (points: any[]) => points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width
    const y = height - ((Number(point.netValue || 1) - min) / span) * height
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="组合策略净值曲线">
        <line x1="0" y1={height - ((1 - min) / span) * height} x2={width} y2={height - ((1 - min) / span) * height} stroke="#475569" strokeDasharray="4 4" />
        {completed.map((strategy, index) => (
          <path
            key={strategy.definition?.strategyId || index}
            d={toPath(strategy.equityCurve)}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="2.5"
          />
        ))}
      </svg>
      <div className="mt-3 flex flex-wrap gap-2">
        {completed.map((strategy, index) => (
          <Tag key={strategy.definition?.strategyId || index} color={colors[index % colors.length]}>
            {strategy.definition?.displayName || strategy.definition?.strategyId}
          </Tag>
        ))}
      </div>
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
  const [portfolioBacktestResult, setPortfolioBacktestResult] = useState<any | null>(null)
  const [portfolioBacktestOperation, setPortfolioBacktestOperation] = useState<any | null>(null)
  const [portfolioBacktestParams, setPortfolioBacktestParams] = useState({
    startDate: '2025-12-04',
    endDate: '2026-06-05',
    initialCapital: 100000,
  })

  useEffect(() => {
    let cancelled = false
    const fetchTemplates = async () => {
      try {
        const response = await axios.get('/api/v1/portfolio-backtest/templates')
        if (!cancelled) setPortfolioTemplates(response.data?.templates || [])
      } catch (error) {
        if (!cancelled) console.error('Failed to fetch portfolio backtest templates:', error)
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
    setPortfolioBacktestLoading(true)
    try {
      const response = await axios.post('/api/v1/portfolio-backtest/run', {
        userId: 'default',
        portfolioStrategyIds: [
          'local_real_data_sample_60_40',
          'local_real_data_equal_weight_5',
          'local_real_data_concentrated_3',
          'permanent_portfolio',
          'all_weather',
          'current_holdings_buy_and_hold',
        ],
        startDate: portfolioBacktestParams.startDate,
        endDate: portfolioBacktestParams.endDate,
        initialCapital: portfolioBacktestParams.initialCapital,
        rebalanceFrequency: 'quarterly',
        dividendMode: 'reinvest',
        feeRate: 0.0003,
        slippageRate: 0.0005,
        benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
        executionMode: 'operation',
      })
      setPortfolioBacktestOperation(response.data?.operationId ? response.data : null)
      setPortfolioBacktestResult(response.data?.result || response.data)
      message.success('组合策略研究回测已完成')
    } catch (error) {
      console.error('Failed to run portfolio backtest:', error)
      message.error('组合策略研究回测失败')
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">策略回测</h1>
      <Card title={<span className="text-primary">组合策略对比回测</span>} className="bg-[#1a1a2e] border-[surface-border]">
        <div className="mb-4 rounded-lg border border-yellow-400/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
          当前仅用于研究、观察和组合比较，不构成交易指令；ADD、REDUCE、ORDER_CREATE、AUTO_TRADE 仍被禁止。分红贡献和正式 total return benchmark 未完整覆盖时，不能升级为交易级验证。
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          <div>
            <div className="mb-1 text-xs text-gray-400">开始日期</div>
            <Input
              value={portfolioBacktestParams.startDate}
              onChange={(event) => setPortfolioBacktestParams((previous) => ({ ...previous, startDate: event.target.value }))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">结束日期</div>
            <Input
              value={portfolioBacktestParams.endDate}
              onChange={(event) => setPortfolioBacktestParams((previous) => ({ ...previous, endDate: event.target.value }))}
            />
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
          <div className="lg:col-span-2 flex items-end gap-2">
            <Button type="primary" loading={portfolioBacktestLoading} onClick={handleRunPortfolioBacktest}>
              运行组合回测
            </Button>
            {portfolioBacktestOperation?.operationId && (
              <Button onClick={() => navigate(`/operations?operationId=${portfolioBacktestOperation.operationId}`)}>
                查看任务产物
              </Button>
            )}
            <Tag color="#64748b">模板 {portfolioTemplates.length}</Tag>
            {portfolioBacktestOperation?.artifactRefs?.length > 0 && (
              <Tag color="#a78bfa">产物 {portfolioBacktestOperation.artifactRefs.length}</Tag>
            )}
          </div>
        </div>
        {portfolioTemplates.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {portfolioTemplates.map((template) => (
              <Tag key={template.strategyId} color="#38bdf8">{template.displayName}</Tag>
            ))}
          </div>
        )}
        {portfolioBacktestResult && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Tag color="#34d399">{portfolioBacktestResult.schemaVersion}</Tag>
              {portfolioBacktestResult.allowedActions?.map((action: string) => <Tag key={action} color="#38bdf8">{action}</Tag>)}
              {portfolioBacktestResult.prohibitedActions?.map((action: string) => <Tag key={action} color="#ef4444">禁止 {action}</Tag>)}
              <Tag color={portfolioBacktestResult.notTradingAdvice ? '#fbbf24' : '#ef4444'}>
                {portfolioBacktestResult.notTradingAdvice ? '非交易建议' : '风险：交易建议标记异常'}
              </Tag>
            </div>
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
                    <div className="text-gray-400">Benchmark</div>
                    <div className="text-right text-white">{strategy.metrics?.benchmarkReturnPercent == null ? '--' : formatPercent(strategy.metrics.benchmarkReturnPercent)}</div>
                    <div className="text-gray-400">超额收益</div>
                    <div className="text-right text-white">{strategy.metrics?.excessReturnPercent == null ? '--' : formatPercent(strategy.metrics.excessReturnPercent)}</div>
                  </div>
                  {(strategy.blockedReasons || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {strategy.blockedReasons.map((reason: string) => <Tag key={reason} color="#ef4444">{reason}</Tag>)}
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
      <Card title={<span className="text-primary">基于建议发起回测</span>} className="bg-[#1a1a2e] border-[surface-border]">
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
            className="bg-[#1a1a2e] border-[surface-border]"
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
          <Card title={<span className="text-primary">回测结果对照</span>} className="bg-[#1a1a2e] border-[surface-border]">
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
          <Card title={<span className="text-primary">权益曲线</span>} className="bg-[#1a1a2e] border-[surface-border]">
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
                  {backtestResult ? '暂无交易记录' : '等待回测结果'}
                </div>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span className="text-primary">回测指标</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <div className="space-y-4">
              <div className="text-gray-300">年化收益率</div>
              <div className="text-2xl text-[success]">{backtestResult?.metrics?.annualizedReturn?.toFixed(2) ?? '--'}%</div>
              <div className="text-gray-300">夏普比率</div>
              <div className="text-2xl text-white">{backtestResult?.metrics?.sharpeRatio?.toFixed(2) ?? '--'}</div>
              <div className="text-gray-300">最大回撤</div>
              <div className="text-2xl text-[danger]">-{backtestResult?.metrics?.maxDrawdown?.toFixed(2) ?? '--'}%</div>
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
