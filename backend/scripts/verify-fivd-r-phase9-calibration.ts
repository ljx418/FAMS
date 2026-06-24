import fs from 'node:fs/promises'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function round(value: number, precision = 6) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

async function main() {
  const verificationDir = path.resolve(process.cwd(), '..', '.verification')
  const replayPath = path.join(verificationDir, 'fivd-r-phase7-advice-replay-audit.json')
  const replay = JSON.parse(await fs.readFile(replayPath, 'utf8'))
  assert(replay.schemaVersion === 'fivd.r.advice_replay.v1', 'Phase 7 replay artifact missing or invalid')
  assert(replay.noFutureLeakAudit?.leaked === false, 'Phase 7 replay has future leak risk')

  const windows = Array.isArray(replay.replayWindows) ? replay.replayWindows : []
  assert(windows.length > 0, 'Phase 7 replay windows missing')
  const modeReports = windows.flatMap((window: any) => Array.isArray(window.modes) ? window.modes : [])
  const gateStrictReports = modeReports.filter((mode: any) => mode.mode === 'gate_strict')
  const researchReports = modeReports.filter((mode: any) => mode.mode === 'research_only')
  const buyHoldReports = modeReports.filter((mode: any) => mode.mode === 'buy_and_hold')
  const benchmarkReports = modeReports.filter((mode: any) => mode.mode === 'benchmark_cash')

  const gateStrictFormalTrades = gateStrictReports.flatMap((mode: any) => mode.simulatedTrades || [])
    .filter((trade: any) => ['ADD', 'REDUCE'].includes(String(trade.action)))
  const buyHoldReturns = buyHoldReports.map((mode: any) => {
    const curve = mode.portfolioCurve || []
    return curve.length > 1 ? Number(curve.at(-1).returnFromReview || 0) : 0
  })
  const benchmarkReturns = benchmarkReports.map((mode: any) => {
    const curve = mode.portfolioCurve || []
    return curve.length > 1 ? Number(curve.at(-1).returnFromReview || 0) : 0
  })
  const avgBuyHoldReturn = buyHoldReturns.length
    ? round(buyHoldReturns.reduce((sum: number, value: number) => sum + value, 0) / buyHoldReturns.length)
    : 0
  const avgBenchmarkReturn = benchmarkReturns.length
    ? round(benchmarkReturns.reduce((sum: number, value: number) => sum + value, 0) / benchmarkReturns.length)
    : 0
  const actionQuality = {
    schemaVersion: 'fivd.r.calibration.action_quality.v1',
    windowsChecked: windows.length,
    gateStrictFormalTrades: gateStrictFormalTrades.length,
    researchOnlyActions: researchReports.length,
    buyHoldBaselineTrades: buyHoldReports.flatMap((mode: any) => mode.simulatedTrades || []).length,
    validationGateRespected: gateStrictFormalTrades.length === 0,
  }
  const probabilityCalibration = {
    schemaVersion: 'fivd.r.calibration.probability.v1',
    p05p95Coverage: {
      status: 'insufficient',
      reason: 'Phase 7 replay artifact does not yet include expectedReturn quantile outcomes for calibration.',
    },
    p25p75Coverage: {
      status: 'insufficient',
      reason: 'Phase 7 replay artifact does not yet include expectedReturn interquartile outcomes for calibration.',
    },
    upsideProbabilityCalibration: {
      status: 'insufficient',
      reason: 'No executable ADD/REDUCE decisions were allowed under validation gate.',
    },
    expectedReturnError: {
      status: 'insufficient',
      reason: 'Expected return distribution is not yet attached to each replay window.',
    },
  }
  const champion = {
    id: 'fivd-r-unified-v1',
    replayArtifact: 'fivd-r-phase7-advice-replay-audit.json',
    avgReturn: avgBuyHoldReturn,
    validationGateRespected: actionQuality.validationGateRespected,
    noFutureLeak: replay.noFutureLeakAudit.leaked === false,
  }
  const challenger = {
    id: 'fivd-r-unified-v1-research-only-shadow',
    replayArtifact: 'fivd-r-phase7-advice-replay-audit.json',
    avgReturn: avgBenchmarkReturn,
    validationGateRespected: true,
    noFutureLeak: replay.noFutureLeakAudit.leaked === false,
  }
  const promoteDecision = {
    status: 'not_promoted',
    requiresHumanConfirmation: true,
    reasons: [
      'Probability calibration is insufficient.',
      'No formal ADD/REDUCE decisions were executable under validation gate.',
      'Challenger comparison uses cash benchmark shadow only.',
    ],
  }
  const report = {
    schemaVersion: 'fivd.r.calibration_report.v1',
    generatedAt: new Date().toISOString(),
    sourceReplayArtifact: replayPath,
    actionQuality,
    probabilityCalibration,
    modelComparison: {
      schemaVersion: 'fivd.r.model_comparison.v1',
      champion,
      challenger,
      promoteDecision,
    },
    blockedReasons: [
      'validation_evidence',
      'probability_calibration_insufficient',
      'human_promotion_required',
    ],
  }

  assert(report.actionQuality.validationGateRespected, 'Gate-Strict formal ADD/REDUCE appeared in calibration source')
  assert(report.modelComparison.promoteDecision.status === 'not_promoted', 'challenger must not be auto-promoted')
  assert(report.modelComparison.promoteDecision.requiresHumanConfirmation === true, 'promote must require human confirmation')

  const auditPath = path.join(verificationDir, 'fivd-r-phase9-calibration-audit.json')
  await fs.writeFile(auditPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    ok: true,
    auditPath,
    checked: {
      windowsChecked: actionQuality.windowsChecked,
      validationGateRespected: actionQuality.validationGateRespected,
      probabilityCalibration: 'insufficient',
      promoteStatus: promoteDecision.status,
      requiresHumanConfirmation: promoteDecision.requiresHumanConfirmation,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
