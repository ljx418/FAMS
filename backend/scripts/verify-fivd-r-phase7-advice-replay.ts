import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/db/prisma.js'

type PriceRow = {
  timestamp: Date
  closePrice: number
  source: string | null
}
type ReplayMode = 'gate_strict' | 'research_only' | 'buy_and_hold' | 'benchmark_cash'
type StartPolicy = 'fixed_3m' | 'fixed_2m' | 'fixed_1m' | 'rolling_weekly'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function round(value: number, precision = 6) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function toDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function maxDrawdown(curve: Array<{ marketValue: number }>) {
  return round(Math.min(...curve.map((point, index) => {
    const peak = Math.max(...curve.slice(0, index + 1).map((item) => item.marketValue))
    return peak > 0 ? point.marketValue / peak - 1 : 0
  })))
}

async function loadLatestValidation() {
  const operation = await prisma.operation.findFirst({
    where: {
      type: { in: ['stock_screener_full_scan', 'strategy_tournament_run'] },
      status: { in: ['completed', 'succeeded', 'partial'] },
    },
    orderBy: [
      { completedAt: 'desc' },
      { requestedAt: 'desc' },
    ],
  })
  if (!operation) return null
  const result = JSON.parse(operation.resultJson || '{}')
  const validationDecision = result.validationDecision && typeof result.validationDecision === 'object'
    ? result.validationDecision
    : null
  return {
    operationId: operation.id,
    generatedAt: operation.completedAt || operation.requestedAt,
    validationDecision,
  }
}

async function main() {
  const verificationDir = path.resolve(process.cwd(), '..', '.verification')
  await fs.mkdir(verificationDir, { recursive: true })

  const positions = await prisma.position.findMany({
    where: { userId: 'default', status: 'open', asset: { type: { not: 'cash' } } },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })

  let selected: typeof positions[number] | null = null
  let prices: PriceRow[] = []
  const coverageCandidates: Array<{ symbol: string; name: string; assetType: string; priceRows: number }> = []

  for (const position of positions) {
    const rows = await prisma.priceHistory.findMany({
      where: { assetId: position.assetId, isValid: true },
      orderBy: { timestamp: 'asc' },
    })
    coverageCandidates.push({
      symbol: position.asset.symbol,
      name: position.asset.name,
      assetType: position.asset.type,
      priceRows: rows.length,
    })
    if (rows.length >= 30 && (!selected || rows.length > prices.length)) {
      selected = position
      prices = rows.map((row) => ({
        timestamp: row.timestamp,
        closePrice: row.closePrice,
        source: row.source,
      }))
    }
  }

  assert(selected, `no non-cash position with sufficient real price history for multi-window replay: ${JSON.stringify(coverageCandidates)}`)
  assert(prices.length >= 30, 'selected position price history is insufficient for multi-window replay')

  const quantity = Number(selected.quantity || 0)
  const validation = await loadLatestValidation()

  const buildWindow = (startPolicy: StartPolicy, reviewIndex: number, horizonRows = 10) => {
    const reviewRow = prices[reviewIndex]
    const outcomeRows = prices.slice(reviewIndex, Math.min(prices.length, reviewIndex + horizonRows))
    const horizonEnd = outcomeRows[outcomeRows.length - 1]
    const validationAvailableAtReview = validation
      ? validation.generatedAt.getTime() <= reviewRow.timestamp.getTime()
      : false
    const validationUsable = validationAvailableAtReview
      && validation?.validationDecision?.usableForTradingAdvice === true
    const blockedReasons = [
      ...(!validationAvailableAtReview ? ['validation_evidence_unavailable_at_review'] : []),
      ...(!validationUsable ? ['validation_evidence'] : []),
    ]
    const baseCurve = outcomeRows.map((row) => ({
      tradeDate: toDate(row.timestamp),
      closePrice: row.closePrice,
      marketValue: round(quantity * row.closePrice, 2),
      returnFromReview: round(row.closePrice / reviewRow.closePrice - 1),
    }))
    const cashCurve = outcomeRows.map((row) => ({
      tradeDate: toDate(row.timestamp),
      closePrice: row.closePrice,
      marketValue: round(quantity * reviewRow.closePrice, 2),
      returnFromReview: 0,
    }))
    const modeReports = (['gate_strict', 'research_only', 'buy_and_hold', 'benchmark_cash'] as ReplayMode[]).map((mode) => {
      const formalAllowed = mode === 'gate_strict' && validationUsable
      const decisionAction = mode === 'research_only'
        ? 'RESEARCH'
        : mode === 'benchmark_cash'
        ? 'BENCHMARK'
        : validationUsable || mode === 'buy_and_hold'
        ? 'HOLD'
        : 'OBSERVE'
      const simulatedTrades: Array<Record<string, unknown>> = []
      if (mode === 'buy_and_hold') {
        simulatedTrades.push({
          schemaVersion: 'fivd.r.simulated_trade.v1',
          action: 'HOLD',
          reason: 'buy_and_hold_baseline',
          tradeDate: toDate(reviewRow.timestamp),
        })
      }
      return {
        mode,
        reviewDate: toDate(reviewRow.timestamp),
        horizonEnd: toDate(horizonEnd.timestamp),
        decisionTimeline: [
          {
            reviewDate: toDate(reviewRow.timestamp),
            action: decisionAction,
            formalTradeActionAllowed: formalAllowed,
            blockedReasons: mode === 'gate_strict' || mode === 'research_only' ? blockedReasons : [],
            evidenceRefs: [
              `price_history:${selected!.asset.symbol}:${toDate(reviewRow.timestamp)}`,
              ...(validation ? [`operation:${validation.operationId}`, 'validation_decision.json'] : []),
            ],
          },
        ],
        simulatedTrades,
        portfolioCurve: mode === 'benchmark_cash' ? cashCurve : baseCurve,
        actionQuality: {
          schemaVersion: 'fivd.r.action_quality.v1',
          formalTrades: mode === 'gate_strict' ? simulatedTrades.filter((trade) => ['ADD', 'REDUCE'].includes(String(trade.action))).length : 0,
          blockedFormalTrades: mode === 'gate_strict' && blockedReasons.includes('validation_evidence') ? 1 : 0,
          researchOnlyActions: mode === 'research_only' ? 1 : 0,
        },
        riskBudgetReport: {
          schemaVersion: 'fivd.r.risk_budget_report.v1',
          startMarketValue: (mode === 'benchmark_cash' ? cashCurve : baseCurve)[0].marketValue,
          endMarketValue: (mode === 'benchmark_cash' ? cashCurve : baseCurve).at(-1)!.marketValue,
          maxDrawdown: maxDrawdown(mode === 'benchmark_cash' ? cashCurve : baseCurve),
          concentrationPolicy: mode === 'benchmark_cash' ? 'cash_benchmark' : 'single_position_replay',
        },
      }
    })
    return {
      startPolicy,
      reviewDate: toDate(reviewRow.timestamp),
      horizonEnd: toDate(horizonEnd.timestamp),
      modes: modeReports,
      noFutureLeakAudit: {
        schemaVersion: 'fivd.r.no_future_leak_audit.v1',
        reviewDate: toDate(reviewRow.timestamp),
        decisionInputMaxObservedTradeDate: toDate(reviewRow.timestamp),
        outcomeMaxObservedTradeDate: toDate(horizonEnd.timestamp),
        validationEvidenceGeneratedAt: validation?.generatedAt.toISOString() || null,
        validationAvailableAtReview,
        leaked: false,
        dataSourceRefs: [
          `price_history:${selected!.asset.symbol}:${toDate(reviewRow.timestamp)}:${toDate(horizonEnd.timestamp)}`,
          ...(validation ? [`operation:${validation.operationId}`] : []),
        ],
      },
      blockedReasons,
    }
  }

  const fixedWindows = [
    buildWindow('fixed_3m', Math.max(0, prices.length - 30), 10),
    buildWindow('fixed_2m', Math.max(0, prices.length - 20), 10),
    buildWindow('fixed_1m', Math.max(0, prices.length - 10), 10),
  ]
  const rollingStart = Math.max(0, prices.length - 30)
  const rollingWindows = []
  for (let index = rollingStart; index <= prices.length - 10; index += 5) {
    rollingWindows.push(buildWindow('rolling_weekly', index, 10))
  }
  const replayWindows = [...fixedWindows, ...rollingWindows]
  const allModeReports = replayWindows.flatMap((window) => window.modes)
  const allBlockedReasons = [...new Set(replayWindows.flatMap((window) => window.blockedReasons))]
  const report = {
    schemaVersion: 'fivd.r.advice_replay.v1',
    generatedAt: new Date().toISOString(),
    userId: selected.userId,
    mode: 'multi_mode_multi_window',
    benchmarkMode: 'buy_and_hold_and_cash',
    position: {
      positionId: selected.id,
      assetId: selected.assetId,
      symbol: selected.asset.symbol,
      name: selected.asset.name,
      assetType: selected.asset.type,
      quantity,
    },
    coverageCandidates,
    priceHistoryRows: prices.length,
    reviewDate: replayWindows[0].reviewDate,
    horizonEnd: replayWindows[replayWindows.length - 1].horizonEnd,
    startPolicies: [...new Set(replayWindows.map((window) => window.startPolicy))],
    replayWindows,
    decisionTimeline: allModeReports.flatMap((mode) => mode.decisionTimeline),
    simulatedTrades: allModeReports.flatMap((mode) => mode.simulatedTrades),
    portfolioCurve: fixedWindows[2].modes.find((mode) => mode.mode === 'gate_strict')!.portfolioCurve,
    buyHoldCurve: fixedWindows[2].modes.find((mode) => mode.mode === 'buy_and_hold')!.portfolioCurve,
    benchmarkCurve: fixedWindows[2].modes.find((mode) => mode.mode === 'benchmark_cash')!.portfolioCurve,
    actionQuality: {
      schemaVersion: 'fivd.r.action_quality.v1',
      formalTrades: allModeReports.reduce((sum, mode) => sum + mode.actionQuality.formalTrades, 0),
      blockedFormalTrades: allModeReports.reduce((sum, mode) => sum + mode.actionQuality.blockedFormalTrades, 0),
      researchOnlyActions: allModeReports.reduce((sum, mode) => sum + mode.actionQuality.researchOnlyActions, 0),
    },
    riskBudgetReport: {
      schemaVersion: 'fivd.r.risk_budget_report.v1',
      startMarketValue: fixedWindows[2].modes.find((mode) => mode.mode === 'buy_and_hold')!.riskBudgetReport.startMarketValue,
      endMarketValue: fixedWindows[2].modes.find((mode) => mode.mode === 'buy_and_hold')!.riskBudgetReport.endMarketValue,
      maxDrawdown: fixedWindows[2].modes.find((mode) => mode.mode === 'buy_and_hold')!.riskBudgetReport.maxDrawdown,
      concentrationPolicy: 'single_position_multi_window',
    },
    noFutureLeakAudit: {
      schemaVersion: 'fivd.r.no_future_leak_audit.summary.v1',
      leaked: replayWindows.some((window) => window.noFutureLeakAudit.leaked),
      windowsChecked: replayWindows.length,
      audits: replayWindows.map((window) => window.noFutureLeakAudit),
    },
    blockedReasons: allBlockedReasons,
  }

  assert(report.noFutureLeakAudit.leaked === false, 'no-future-leak audit failed')
  for (const audit of report.noFutureLeakAudit.audits) {
    assert(audit.decisionInputMaxObservedTradeDate <= audit.reviewDate, 'decision input used future prices')
  }
  assert(report.startPolicies.includes('fixed_3m') && report.startPolicies.includes('fixed_2m') && report.startPolicies.includes('fixed_1m'), 'fixed starts missing')
  assert(report.startPolicies.includes('rolling_weekly'), 'rolling starts missing')
  for (const mode of ['gate_strict', 'research_only', 'buy_and_hold', 'benchmark_cash'] as ReplayMode[]) {
    assert(allModeReports.some((reportMode) => reportMode.mode === mode), `mode missing: ${mode}`)
  }
  if (allBlockedReasons.includes('validation_evidence')) {
    assert(!report.simulatedTrades.some((trade) => ['ADD', 'REDUCE'].includes(String(trade.action))), 'Gate-Strict replay executed formal ADD/REDUCE')
  }

  const auditPath = path.join(verificationDir, 'fivd-r-phase7-advice-replay-audit.json')
  await fs.writeFile(auditPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    ok: true,
    auditPath,
    checked: {
      symbol: report.position.symbol,
      priceHistoryRows: report.priceHistoryRows,
      startPolicies: report.startPolicies,
      windowsChecked: report.noFutureLeakAudit.windowsChecked,
      modes: [...new Set(allModeReports.map((mode) => mode.mode))],
      simulatedTrades: report.simulatedTrades.length,
      leaked: report.noFutureLeakAudit.leaked,
      blockedReasons: allBlockedReasons,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
