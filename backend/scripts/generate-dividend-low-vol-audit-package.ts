import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendLowVolBacktestService } from '../src/services/dividend-low-vol/dividendLowVolBacktestService.js'
import { buildDividendLowVolRejectionAudit } from '../src/services/dividend-low-vol/dividendLowVolRejectionTaxonomy.js'
import { dividendLowVolFormalProviderIngestionService } from '../src/services/dividend-low-vol/formalProviderIngestionService.js'
import { dividendLowVolTotalReturnAuditService } from '../src/services/dividend-low-vol/dividendTotalReturnAuditService.js'
import { dividendLowVolDataReadinessService } from '../src/services/dividend-low-vol/dividendLowVolDataReadinessService.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolTradingZoneService } from '../src/services/dividend-low-vol/dividendLowVolTradingZoneService.js'
import { prisma } from '../src/db/prisma.js'
import type { DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

const execFileAsync = promisify(execFile)
const GENERATED_AT = new Date().toISOString()
const STRATEGY_ID = 'dividend_low_vol_leader_v1'
const STRATEGY_FAMILY = 'dividend_low_volatility'
const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT']
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'AUTO_TRADE']

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function backendRoot() {
  return resolve(repoRoot(), 'backend')
}

function auditBaseDir() {
  return resolve(backendRoot(), 'data/gpt-audit')
}

function packageDir() {
  return resolve(auditBaseDir(), 'dividend-low-vol', GENERATED_AT.replace(/[:.]/g, '-'))
}

function common(operationId?: string | null, knownIncompleteItems: string[] = []) {
  return {
    generatedAt: GENERATED_AT,
    strategyId: STRATEGY_ID,
    strategyFamily: STRATEGY_FAMILY,
    gitCommit: 'unavailable',
    dataVersion: 'research_audit_package_v1',
    operationId: operationId || null,
    inputUniverse: 'latest_persisted_or_fixture_fallback',
    providerSummary: {
      status: 'reported_in_05_data_verification_audit',
    },
    knownIncompleteItems,
    allowedActions: ALLOWED_ACTIONS,
    prohibitedActions: PROHIBITED_ACTIONS,
    notTradingAdvice: true,
  }
}

function history(start: number, days: number, drift: number, symbol = 'fixture') {
  const rows = []
  const startDate = new Date('2025-01-01T00:00:00.000Z')
  for (let index = 0; index < days; index += 1) {
    const close = start + (index * drift) + Math.sin(index / 11) * 0.3
    const previousClose = index === 0 ? close : start + ((index - 1) * drift) + Math.sin((index - 1) / 11) * 0.3
    rows.push({
      date: new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 8_000_000,
      amount: close * 8_000_000,
      isTradable: true,
      tradabilityStatus: 'tradable' as const,
      isSuspended: false,
      limitUp: previousClose * 1.1,
      limitDown: previousClose * 0.9,
      tradeabilityEvidenceRef: `audit-fixture:tradeability:${symbol}:${index}:bar-derived-limit`,
    })
  }
  return rows
}

function fixtureInputs(): DividendLowVolInput[] {
  return [
    {
      symbol: '600000',
      name: '浦发银行',
      industry: '银行',
      listingAgeDays: 365 * 15,
      price: 10,
      dividendRecords: [
        { year: 2023, dividendPerShare: 0.65, exDividendDate: '2024-06-10', payoutDate: '2024-06-20', evidenceRef: 'audit-fixture:600000:dividend:2023' },
        { year: 2024, dividendPerShare: 0.72, exDividendDate: '2025-06-10', payoutDate: '2025-06-20', evidenceRef: 'audit-fixture:600000:dividend:2024' },
        { year: 2025, dividendPerShare: 0.82, exDividendDate: '2026-06-10', payoutDate: '2026-06-20', evidenceRef: 'audit-fixture:600000:dividend:2025' },
      ],
      ttmDividendPerShare: 0.82,
      payoutRatio: 45,
      operatingCashFlowToNetProfit: 1.2,
      roe: 12,
      debtToAsset: 58,
      pe: 7,
      pb: 0.7,
      totalMarketCap: 300_000_000_000,
      avgTurnoverAmount60: 800_000_000,
      leaderScore: 88,
      marketCapRankScore: 92,
      revenueRankScore: 82,
      netProfitRankScore: 86,
      roeIndustryPercentile: 75,
      liquidityRankScore: 80,
      history: history(12, 160, -0.004, '600000'),
      evidenceRefs: ['audit-fixture:600000:annual-report'],
    },
    {
      symbol: '000001',
      name: '平安银行',
      industry: '银行',
      listingAgeDays: 365 * 15,
      price: 8,
      dividendRecords: [
        { year: 2023, dividendPerShare: 0.9, exDividendDate: '2024-06-10', payoutDate: '2024-06-20', evidenceRef: 'audit-fixture:000001:dividend:2023' },
        { year: 2024, dividendPerShare: 0.7, exDividendDate: '2025-06-10', payoutDate: '2025-06-20', evidenceRef: 'audit-fixture:000001:dividend:2024' },
        { year: 2025, dividendPerShare: 0.45, exDividendDate: '2026-06-10', payoutDate: '2026-06-20', evidenceRef: 'audit-fixture:000001:dividend:2025' },
      ],
      ttmDividendPerShare: 0.8,
      payoutRatio: 110,
      operatingCashFlowToNetProfit: 0.4,
      roe: 8,
      debtToAsset: 72,
      pe: 6,
      pb: 0.55,
      totalMarketCap: 180_000_000_000,
      avgTurnoverAmount60: 600_000_000,
      leaderScore: 80,
      history: history(10, 160, -0.01, '000001'),
      evidenceRefs: ['audit-fixture:000001:annual-report'],
    },
  ]
}

async function getGitCommit() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot(), timeout: 3000 })
    return stdout.trim()
  } catch {
    return 'unavailable'
  }
}

async function latestRuntimeHealth() {
  const root = resolve(auditBaseDir(), 'dividend-low-vol')
  try {
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort()
      .reverse()
    for (const dir of dirs) {
      const path = resolve(root, dir, '11_runtime_health_audit.json')
      const content = await readFile(path, 'utf8').catch(() => null)
      if (content) return JSON.parse(content)
    }
  } catch {
    // ignore and return fallback below
  }
  return {
    schemaVersion: 'dividend.low_vol.runtime_health_audit.v1',
    ...common(null, ['runtime health script has not been executed before this package']),
    status: 'unknown',
    decision: {
      largeDividendLowVolScanAllowed: false,
      largeBacktestPersistenceAllowed: false,
      reason: 'runtime_health_audit_missing',
    },
  }
}

async function loadJson(path: string) {
  return readFile(path, 'utf8').then((content) => JSON.parse(content)).catch(() => null)
}

async function latestValidationRetest() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root)).filter((file) => file.startsWith('dividend-low-vol-validation-retest-')).sort().reverse()
    const loaded = []
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) loaded.push({ file, payload })
    }
    const real = loaded.find((item) => item.payload.validationRunMode === 'real_latest_persisted')
    if (real) return {
      ...real.payload,
      artifactSourceFile: real.file,
    }
    const nonFixture = loaded.find((item) => !String(item.payload.validationRunMode || '').includes('fixture'))
    if (nonFixture) return {
      ...nonFixture.payload,
      artifactSourceFile: nonFixture.file,
    }
  } catch {
    // ignore
  }
  return null
}

async function latestExpandedSampleValidation() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root)).filter((file) => file.startsWith('dividend-low-vol-expanded-sample-validation-')).sort().reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestV2ResearchValidation() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root)).filter((file) => file.startsWith('dividend-low-vol-v2-research-validation-')).sort().reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestFrontendRuntimeContract() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root)).filter((file) => file.startsWith('dividend-low-vol-frontend-runtime-contract-')).sort().reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestFormalPromotionPlan() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root)).filter((file) => file.startsWith('dividend-low-vol-formal-promotion-plan-')).sort().reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestManualTradeDraftReadiness() {
  const operation = await prisma.operation.findFirst({
    where: {
      type: 'strategy_tournament_run',
      status: { in: ['completed', 'succeeded', 'partial'] },
      idempotencyKey: { startsWith: 'dividend-low-vol-strategy-evidence:' },
    },
    orderBy: [
      { completedAt: 'desc' },
      { requestedAt: 'desc' },
    ],
  })
  if (!operation) {
    return {
      schemaVersion: 'dividend.low_vol.manual_trade_draft_readiness.v1',
      generatedAt: GENERATED_AT,
      status: 'no_evidence',
      readyForManualTradeDraft: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      primaryBlocker: 'strategy_evidence_missing',
      latestEvidence: null,
    }
  }
  const result = operation.resultJson ? JSON.parse(operation.resultJson) : {}
  const acceptance = result.longSampleAcceptance || {}
  const summary = acceptance.summary || {}
  const validationDecision = result.validationDecision || {}
  const gates = Array.isArray(acceptance.gates) ? acceptance.gates : []
  const failedBlockers = gates.filter((gate: any) => gate?.severity === 'blocker' && gate?.status !== 'passed')
  const readyForManualTradeDraft = validationDecision.usableForTradingAdvice === true && failedBlockers.length === 0
  return {
    schemaVersion: 'dividend.low_vol.manual_trade_draft_readiness.v1',
    generatedAt: GENERATED_AT,
    status: readyForManualTradeDraft ? 'ready_for_manual_trade_draft' : 'blocked',
    readyForManualTradeDraft,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    decision: validationDecision.decision || (readyForManualTradeDraft ? 'READY_FOR_MANUAL_TRADE_DRAFT' : 'OBSERVE_ONLY'),
    allowedActions: validationDecision.allowedActions || ALLOWED_ACTIONS,
    prohibitedActions: validationDecision.prohibitedActions || PROHIBITED_ACTIONS,
    primaryBlocker: validationDecision.primaryBlocker || (readyForManualTradeDraft ? null : 'validation_evidence'),
    latestEvidence: {
      operationId: operation.id,
      generatedAt: operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
      acceptanceStatus: acceptance.status || 'unknown',
      scanCoveragePercent: summary.scanCoveragePercent ?? null,
      providerSuccessRate: summary.providerSuccessRate ?? null,
      cacheHitRate: summary.cacheHitRate ?? null,
      backtestDays: summary.backtestDays ?? null,
      bestSampleSize: summary.bestSampleSize ?? null,
      bestCredibility: summary.bestCredibility ?? null,
      topCandidates: acceptance.topCandidates || [],
    },
    gates,
    recommendations: acceptance.recommendations || [],
    safetyBoundary: 'Manual trade draft readiness is not an order instruction; formal ADD / REDUCE and AUTO_TRADE remain prohibited.',
  }
}

async function latestPersistedManualTradeDraft() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-draft-') && file.endsWith('.json'))
      .sort()
      .reverse()
    const loaded = []
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) loaded.push({
        ...payload,
        artifactSourceFile: file,
      })
    }
    const withActions = loaded.find((payload) => Array.isArray(payload.actions) && payload.actions.length > 0)
    if (withActions) return withActions
    if (loaded[0]) return loaded[0]
  } catch {
    // ignore
  }
  return null
}

async function latestPersistedManualTradeDraftReview() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-draft-review-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestManualWatchlist() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-watchlist-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestManualPretradeCheck() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-pretrade-check-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestManualPretradeReview() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-pretrade-review-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function latestManualAcceptanceDecision() {
  const root = auditBaseDir()
  try {
    const files = (await readdir(root))
      .filter((file) => file.startsWith('dividend-low-vol-manual-acceptance-decision-') && file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const payload = await loadJson(resolve(root, file))
      if (payload) return {
        ...payload,
        artifactSourceFile: file,
      }
    }
  } catch {
    // ignore
  }
  return null
}

function buildManualTradeDraftAudit(pool: any, readiness: any) {
  const candidates = Array.isArray(pool?.candidates) ? pool.candidates : []
  const top = candidates
    .filter((candidate: any) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
    .sort((left: any, right: any) => (right.scores?.evidenceAdjustedScore || 0) - (left.scores?.evidenceAdjustedScore || 0))
    .slice(0, 3)
  return {
    schemaVersion: 'dividend.low_vol.manual_trade_draft_user_path_audit.v1',
    generatedAt: GENERATED_AT,
    status: readiness.readyForManualTradeDraft ? 'ready_for_manual_review' : 'blocked',
    readyForManualTradeDraft: readiness.readyForManualTradeDraft,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    prohibitedActions: PROHIBITED_ACTIONS,
    top3: top.map((candidate: any, index: number) => ({
      rank: index + 1,
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      industry: candidate.identity.industry,
      disposition: candidate.disposition,
      isHolding: candidate.positionContext?.isHolding === true,
      currentWeightPercent: candidate.positionContext?.portfolioWeightPercent || 0,
      researchTargetWeightPercent: candidate.positionContext?.researchTargetWeightPercent || 0,
      formalTargetWeightPercent: 0,
      evidenceAdjustedScore: candidate.scores?.evidenceAdjustedScore ?? null,
      ttmDividendYield: candidate.dividend?.ttmDividendYield ?? null,
      avgDividendYield3y: candidate.dividend?.avgDividendYield3y ?? null,
      leaderScore: candidate.scores?.leaderScore ?? null,
      lowVolScore: candidate.scores?.lowVolScore ?? null,
      guardrail: 'Manual review draft only; not a formal ADD / REDUCE order.',
    })),
    userPath: [
      'Open Dividend Low Vol left-menu page.',
      'Confirm Manual Draft Gate is READY.',
      'Review Top 3 manual draft cards and expanded candidate facts.',
      'Check holding weight, single-stock cap, industry cap, suspension/limit state and evidence refs.',
      'Submit to manual review process; do not auto trade.',
    ],
  }
}

async function latestPool() {
  try {
    const auditPoolLimit = Math.max(1, Math.min(6000, Number(process.env.FAMS_DIVIDEND_LOW_VOL_AUDIT_POOL_LIMIT || process.env.FAMS_DIVIDEND_LOW_VOL_MAX_LIMIT || 6000)))
    const pool = await dividendLowVolStrategyService.getLatestCandidatePool('default', {
      limit: auditPoolLimit,
      scope: 'all_latest_by_symbol',
    })
    return { source: 'latest_persisted', pool, error: null as string | null }
  } catch (error) {
    const pool = dividendLowVolStrategyService.buildCandidatePool(fixtureInputs())
    return {
      source: 'fixture_fallback_due_to_database_unavailable',
      pool,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function backtestInputsForAudit(pool: Awaited<ReturnType<typeof dividendLowVolStrategyService.getLatestCandidatePool>>) {
  if (/^(1|true|yes)$/i.test(process.env.FAMS_DIVIDEND_LOW_VOL_AUDIT_FAST || '')) {
    return {
      source: 'fixture_fast_audit_mode',
      inputs: fixtureInputs(),
      error: null as string | null,
    }
  }
  const symbols = Array.from(new Set((pool.candidates || [])
    .map((candidate) => candidate.identity?.symbol)
    .filter((symbol): symbol is string => /^\d{6}$/.test(String(symbol)))))
    .slice(0, 40)
  if (symbols.length === 0) {
    return {
      source: 'fixture_no_latest_candidate_symbols',
      inputs: fixtureInputs(),
      error: null as string | null,
    }
  }
  try {
    return {
      source: 'latest_persisted_symbols_rebuilt_with_input_builder',
      inputs: await dividendLowVolInputBuilderService.buildFromSymbols(symbols, symbols.length, { historyDays: 756 }),
      error: null as string | null,
    }
  } catch (error) {
    return {
      source: 'fixture_fallback_due_to_input_builder_failure',
      inputs: fixtureInputs(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function writeJson(dir: string, fileName: string, payload: unknown) {
  const path = resolve(dir, fileName)
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return path
}

async function writeText(dir: string, fileName: string, content: string) {
  const path = resolve(dir, fileName)
  await writeFile(path, content, 'utf8')
  return path
}

async function sha256(path: string) {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

async function main() {
  const dir = packageDir()
  await mkdir(dir, { recursive: true })
  const gitCommit = await getGitCommit()
  const runtimeHealth = await latestRuntimeHealth()
  const poolResult = await latestPool()
  const pool = poolResult.pool
  const rejectionAudit = {
    ...common(null, poolResult.error ? ['candidate pool used fixture fallback because database read failed'] : []),
    gitCommit,
    ...buildDividendLowVolRejectionAudit(pool.candidates),
    source: poolResult.source,
    sourceError: poolResult.error,
  }
  const backtestInputResult = await backtestInputsForAudit(pool)
  const backtest = dividendLowVolBacktestService.run(backtestInputResult.inputs, { dividendReinvestment: true })
  const tradingZoneAudit = dividendLowVolTradingZoneService.buildTradingZones(backtestInputResult.inputs, { limit: 80 })
  const rollingStrategyBacktest = dividendLowVolTradingZoneService.runRollingBacktest(backtestInputResult.inputs, { years: 3 })
  const providerIngestionAudit = dividendLowVolFormalProviderIngestionService.buildAudit()
  const dataReadinessAudit = await dividendLowVolDataReadinessService.buildAudit()
  const totalReturnBacktestAudit = dividendLowVolTotalReturnAuditService.buildAudit(backtest)
  const totalReturnValidationReady = ['formal_grade_ready', 'free_source_validation_ready'].includes(totalReturnBacktestAudit.status)
  const latestValidation = await latestValidationRetest()
  const expandedSampleValidation = await latestExpandedSampleValidation()
  const v2ResearchValidation = await latestV2ResearchValidation()
  const frontendRuntimeContract = await latestFrontendRuntimeContract()
  const formalPromotionPlan = await latestFormalPromotionPlan()
  const manualTradeDraftReadiness = await latestManualTradeDraftReadiness()
  const persistedManualTradeDraft = await latestPersistedManualTradeDraft()
  const persistedManualTradeDraftReview = await latestPersistedManualTradeDraftReview()
  const manualWatchlist = await latestManualWatchlist()
  const manualPretradeCheck = await latestManualPretradeCheck()
  const manualPretradeReview = await latestManualPretradeReview()
  const manualAcceptanceDecision = await latestManualAcceptanceDecision()
  const manualWorkflowAudit = {
    schemaVersion: 'dividend.low_vol.manual_workflow_audit.v1',
    generatedAt: GENERATED_AT,
    status: [persistedManualTradeDraft, persistedManualTradeDraftReview, manualWatchlist, manualPretradeCheck, manualPretradeReview, manualAcceptanceDecision].every(Boolean)
      ? 'complete_observation_workflow'
      : 'partial_workflow',
    stages: [
      { id: 'manual_trade_draft', label: '人工草案', status: persistedManualTradeDraft?.status || 'missing', artifactId: persistedManualTradeDraft?.draftId || null, artifactSourceFile: persistedManualTradeDraft?.artifactSourceFile || null },
      { id: 'manual_trade_draft_review', label: '草案复核', status: persistedManualTradeDraftReview?.decision || 'missing', artifactId: persistedManualTradeDraftReview?.reviewId || null, artifactSourceFile: persistedManualTradeDraftReview?.artifactSourceFile || null },
      { id: 'manual_watchlist', label: '人工观察清单', status: manualWatchlist?.status || 'missing', artifactId: manualWatchlist?.watchlistId || null, artifactSourceFile: manualWatchlist?.artifactSourceFile || null },
      { id: 'manual_pretrade_check', label: '执行前检查单', status: manualPretradeCheck?.status || 'missing', artifactId: manualPretradeCheck?.checkId || null, artifactSourceFile: manualPretradeCheck?.artifactSourceFile || null },
      { id: 'manual_pretrade_review', label: '检查结论', status: manualPretradeReview?.decision || 'missing', artifactId: manualPretradeReview?.reviewId || null, artifactSourceFile: manualPretradeReview?.artifactSourceFile || null },
      { id: 'manual_acceptance_decision', label: '人工验收结论', status: manualAcceptanceDecision?.decision || 'missing', artifactId: manualAcceptanceDecision?.decisionId || null, artifactSourceFile: manualAcceptanceDecision?.artifactSourceFile || null },
    ].map((stage) => ({
      ...stage,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    })),
    summary: {
      completedStages: [persistedManualTradeDraft, persistedManualTradeDraftReview, manualWatchlist, manualPretradeCheck, manualPretradeReview, manualAcceptanceDecision].filter(Boolean).length,
      totalStages: 6,
      latestDecision: manualAcceptanceDecision?.decision || manualPretradeReview?.decision || persistedManualTradeDraftReview?.decision || null,
      executionReady: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
    notTradingAdvice: true,
  }
  const v2Evidence = v2ResearchValidation?.backtest?.validationEvidence || null
  const v2EvidenceStatuses = [
    v2Evidence?.outOfSample,
    v2Evidence?.walkForward,
    v2Evidence?.parameterSensitivity,
    v2Evidence?.groupStability,
  ]
  const v2ResearchEvidencePassed = v2ResearchValidation?.status === 'research_candidate_passed'
    && v2EvidenceStatuses.every((status) => status === 'candidate_passed')
    && Number(v2ResearchValidation?.backtest?.sample?.effectivePathCount || 0) >= 100
  const strictValidationEvidencePassed = latestValidation?.validationDecision?.usableForTradingAdvice === true
  const bestValidationEvidence = strictValidationEvidencePassed
    ? {
      source: 'strict_validation_retest',
      sourceArtifact: latestValidation?.artifactSourceFile || latestValidation?.artifactRef?.fileName || null,
      evidence: latestValidation?.backtest?.validationEvidence || null,
      sample: latestValidation?.backtest?.sample || null,
      status: latestValidation?.validationEvidenceMatrix?.status || latestValidation?.backtest?.validationEvidence?.status || 'unknown',
      researchPassed: true,
      usableForTradingAdvice: true,
    }
    : v2ResearchEvidencePassed
      ? {
        source: 'v2_research_validation',
        sourceArtifact: v2ResearchValidation?.artifactSourceFile || null,
        evidence: v2ResearchValidation?.backtest?.validationEvidence || null,
        sample: v2ResearchValidation?.backtest?.sample || null,
        status: v2ResearchValidation?.backtest?.validationEvidence?.status || v2ResearchValidation?.status || 'unknown',
        researchPassed: true,
        usableForTradingAdvice: false,
      }
      : {
        source: 'current_backtest_fixture_or_rebuilt_inputs',
        sourceArtifact: null,
        evidence: (backtest as any).validationEvidence || null,
        sample: (backtest as any).sample || null,
        status: (backtest as any).validationEvidence?.status || 'missing',
        researchPassed: false,
        usableForTradingAdvice: false,
      }
  const validationGapDiagnostics = (() => {
    const gaps: Array<{
      id: string
      severity: 'blocker' | 'warning' | 'info'
      category: string
      status: string
      affectedGate: string
      userMessage: string
      developerAction: string
      formalValidationBlocked: boolean
    }> = []
    const push = (gap: (typeof gaps)[number]) => gaps.push(gap)
    for (const blocker of dataReadinessAudit.researchBlockers || dataReadinessAudit.blockers || []) {
      push({
        id: blocker,
        severity: 'blocker',
        category: 'free_source_data',
        status: 'blocked',
        affectedGate: 'research_scan_ready',
        userMessage: `免费源研究数据仍缺 ${blocker}，不能稳定重跑全 A 研究扫描。`,
        developerAction: '刷新 quote list、market bars、features、security status 和 tradeability 后重跑 data readiness。',
        formalValidationBlocked: true,
      })
    }
    for (const blocker of dataReadinessAudit.providerUpgradeBlockers || []) {
      push({
        id: blocker,
        severity: 'warning',
        category: 'provider_upgrade',
        status: 'optional_upgrade_pending',
        affectedGate: 'formal_provider_upgrade',
        userMessage: `${blocker} 是 Tushare/正式 provider 升级项，不阻断免费源研究验证。`,
        developerAction: '保留 Tushare token 配置和 ingestion skeleton；需要正式 provider 时再启用。',
        formalValidationBlocked: false,
      })
    }
    for (const blocker of (backtest as any).formalBacktestGate?.blockers || []) {
      push({
        id: blocker,
        severity: 'blocker',
        category: 'total_return_backtest',
        status: 'blocked',
        affectedGate: 'formal_backtest_gate',
        userMessage: `${blocker} 未满足，回测不能标记为 formal-grade。`,
        developerAction: String(blocker).includes('benchmark')
          ? '接入或生成可追溯 total-return benchmark，并保留 evidenceRefs。'
          : '补齐除权分红总回报序列、涨跌停和停牌逐日交易约束。',
        formalValidationBlocked: true,
      })
    }
    const validationChecks = bestValidationEvidence.evidence || {}
    for (const [id, status] of Object.entries({
      out_of_sample: validationChecks.outOfSample,
      walk_forward: validationChecks.walkForward,
      parameter_sensitivity: validationChecks.parameterSensitivity,
      group_stability: validationChecks.groupStability,
    })) {
      if (status === 'candidate_passed') continue
      push({
        id,
        severity: status === 'failed' ? 'blocker' : 'warning',
        category: 'validation_evidence',
        status: String(status || 'missing'),
        affectedGate: id,
        userMessage: `${id} 当前为 ${status || 'missing'}，仍不能作为正式交易动作依据。`,
        developerAction: bestValidationEvidence.source === 'current_backtest_fixture_or_rebuilt_inputs'
          ? '扩大样本、延长窗口、补齐分组样本，并重跑 validation retest。'
          : '大样本研究验证已改善该项；人工验收时需复核样本来源、行业分组和参数邻域证据。',
        formalValidationBlocked: true,
      })
    }
    const blockingGapCount = gaps.filter((gap) => gap.formalValidationBlocked).length
    const diagnosticsStatus = blockingGapCount > 0
      ? 'formal_validation_blocked'
      : bestValidationEvidence.usableForTradingAdvice
        ? 'formal_validation_gap_clear_manual_trade_draft_ready'
        : 'research_validation_gap_clear_manual_acceptance_required'
    return {
      schemaVersion: 'dividend.low_vol.validation_gap_diagnostics.v1',
      generatedAt: GENERATED_AT,
      strategyId: STRATEGY_ID,
      status: diagnosticsStatus,
      summary: {
        totalGaps: gaps.length,
        blockingGapCount,
        warningGapCount: gaps.filter((gap) => gap.severity === 'warning').length,
        freeSourceResearchReady: dataReadinessAudit.gates.researchScanReady,
        freeSourceValidationAllowed: dataReadinessAudit.gates.freeSourceValidationAllowed,
        formalBacktestReady: (backtest as any).formalBacktestGate?.ready === true,
        backtestStatus: (backtest as any).status,
        totalReturnAuditStatus: totalReturnBacktestAudit.status,
        validationEvidenceStatus: bestValidationEvidence.status,
        validationEvidenceSource: bestValidationEvidence.source,
        validationEvidenceSourceArtifact: bestValidationEvidence.sourceArtifact,
        validationResearchPassed: bestValidationEvidence.researchPassed,
        validationUsableForTradingAdvice: bestValidationEvidence.usableForTradingAdvice,
      },
      gaps,
      validationEvidenceSnapshot: bestValidationEvidence,
      backtestSnapshot: {
        sample: (backtest as any).sample,
        metrics: (backtest as any).metrics,
        benchmark: (backtest as any).benchmark,
        formalBacktestGate: (backtest as any).formalBacktestGate,
        tradeConstraintAudit: (backtest as any).tradeConstraintAudit,
        validationEvidence: (backtest as any).validationEvidence,
      },
      dataReadinessSnapshot: {
        status: dataReadinessAudit.status,
        providerMode: dataReadinessAudit.providerMode,
        validationDataMode: dataReadinessAudit.validationDataMode,
        formalBlockers: dataReadinessAudit.formalBlockers,
        providerUpgradeBlockers: dataReadinessAudit.providerUpgradeBlockers,
        researchBlockers: dataReadinessAudit.researchBlockers || dataReadinessAudit.blockers,
      },
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  })()
  const manualTradeDraftUserPathAudit = buildManualTradeDraftAudit(pool, manualTradeDraftReadiness)
  const tracker = await loadJson(resolve(auditBaseDir(), 'dividend-low-vol-development-tracker.json'))
  const dataAcquisitionAudit = await loadJson(resolve(auditBaseDir(), 'dividend-low-vol-data-acquisition-audit.json'))
  const auditBacklog = await loadJson(resolve(auditBaseDir(), 'dividend-low-vol-audit-backlog.json'))

  const artifacts: Array<{ fileName: string; purpose: string; path: string }> = []
  const addJson = async (fileName: string, purpose: string, payload: unknown) => {
    artifacts.push({ fileName, purpose, path: await writeJson(dir, fileName, payload) })
  }
  const addText = async (fileName: string, purpose: string, content: string) => {
    artifacts.push({ fileName, purpose, path: await writeText(dir, fileName, content) })
  }

  await addText('README.md', 'Human-readable audit package entrypoint', `# Dividend Low Volatility GPT Audit Package\n\nGeneratedAt: ${GENERATED_AT}\n\nStrategyId: \`${STRATEGY_ID}\`\n\nThis package is for GPT audit only. It is not trading advice.\n\nAllowed actions: ${ALLOWED_ACTIONS.join(', ')}\n\nProhibited actions: ${PROHIBITED_ACTIONS.join(', ')}\n\nCandidate source: ${poolResult.source}\n\n${poolResult.error ? `Database read error: ${poolResult.error}\n` : ''}\n`)
  await addJson('01_candidate_pool.json', 'Latest candidate pool or fixture fallback when DB is unavailable', {
    ...common(null, poolResult.error ? ['candidate pool source is fixture fallback'] : []),
    gitCommit,
    source: poolResult.source,
    sourceError: poolResult.error,
    candidatePool: pool,
  })
  await addJson('02_rejection_audit.json', 'Rejection reasons split into data_gap, hard_rule_failure, risk_flag and validation_blocker', rejectionAudit)
  await addJson('03_leader_evidence_audit.json', 'Industry leader evidence status and seed fallback disclosure', {
    ...common(undefined, ['verified_industry_leader requires provider-cross-checked revenue/net-profit/ROE rank evidence']),
    gitCommit,
    phase: 'Phase 3',
    status: pool.candidates.some((candidate) => candidate.leaderEvidence?.status === 'verified_industry_leader') ? 'partial' : 'blocked',
    leaderAuditSummary: pool.leaderAuditSummary,
    candidates: pool.candidates.map((candidate) => ({
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      industry: candidate.identity.industry,
      leaderScore: candidate.scores.leaderScore,
      status: candidate.leaderEvidence?.status || 'insufficient',
      leaderEvidence: candidate.leaderEvidence,
      evidenceRefs: candidate.leaderEvidence?.evidenceRefs || candidate.evidenceRefs.filter((ref) => ref.includes('leader') || ref.includes('industry') || ref.includes('quote-list')).slice(0, 20),
      note: 'seed fallback or market-cap evidence is not verified_industry_leader without revenue/net-profit/ROE rank cross-check.',
    })),
  })
  await addJson('leader_evidence_audit.json', 'Alias: industry leader evidence audit for user review', {
    ...common(undefined, ['verified_industry_leader requires provider-cross-checked revenue/net-profit/ROE rank evidence']),
    gitCommit,
    status: pool.candidates.some((candidate) => candidate.leaderEvidence?.status === 'verified_industry_leader') ? 'partial' : 'blocked',
    candidates: pool.candidates.map((candidate) => ({
      symbol: candidate.identity.symbol,
      status: candidate.leaderEvidence?.status || 'insufficient',
      leaderEvidence: candidate.leaderEvidence,
    })),
  })
  await addJson('04_dividend_factset_audit.json', 'Dividend factset, sustainable dividend and dividend trap evidence', {
    ...common(undefined, ['exchange announcement event-state parsing remains planned for formal cross-check']),
    gitCommit,
    phase: 'Phase 4',
    status: pool.candidates.every((candidate) => candidate.dividend.sourceRefs && candidate.dividend.cashDividendPerShareHistory.length > 0) ? 'implemented_research_grade' : 'partial',
    candidates: pool.candidates.map((candidate) => ({
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      dividend: candidate.dividend,
      disposition: candidate.disposition,
      blockedReasons: candidate.blockedReasons,
      evidenceRefs: candidate.evidenceRefs.filter((ref) => ref.includes('dividend') || ref.includes('fundamental')).slice(0, 30),
    })),
  })
  await addJson('05_data_verification_audit.json', 'Provider, sourceRef, freshness and external data acquisition audit', {
    ...common(undefined, ['free-source validation is allowed; formal provider ingestion remains an optional upgrade unless configured externally']),
    gitCommit,
    phase: 'Phase 5',
    status: dataReadinessAudit.gates.freeSourceValidationAllowed ? 'free_source_validation_ready_provider_upgrade_pending' : 'blocked_free_source_data_incomplete',
    dataAcquisitionAudit,
    providerIngestionAudit,
    providerStatuses: pool.candidates.map((candidate) => ({
      symbol: candidate.identity.symbol,
      dataVerification: candidate.dataVerification,
      dataGapSummary: candidate.dataGapSummary,
    })),
  })
  await addJson('data_readiness_audit.json', 'All-A data readiness, provider coverage and scan blocker audit', dataReadinessAudit)
  await addJson('provider_ingestion_audit.json', 'Formal provider ingestion skeleton and field-level contracts', providerIngestionAudit)
  await addJson('06_backtest_result.json', 'Research backtest with dividend contribution, benchmark proxy and trade constraints audit', {
    ...common(undefined, [
      ...(backtestInputResult.error ? ['backtest input builder failed and fixture fallback was used'] : []),
      ...(totalReturnValidationReady ? [] : ['free-source total-return benchmark, ex-dividend series or trade constraints incomplete']),
    ]),
    gitCommit,
    phase: 'Phase 6',
    status: totalReturnBacktestAudit.status,
    backtestInputSource: backtestInputResult.source,
    backtestInputError: backtestInputResult.error,
    backtest,
    totalReturnBacktestAudit,
  })
  await addJson('dividend_total_return_backtest.json', 'Dividend total-return backtest audit and blockers', totalReturnBacktestAudit)
  await addJson('30_trading_zone_model_audit.json', 'Dividend low-vol buy/sell zone model audit for Bollinger and yield-MA strategies', {
    ...common(undefined, []),
    gitCommit,
    source: backtestInputResult.source,
    sourceError: backtestInputResult.error,
    tradingZones: tradingZoneAudit,
    modelBoundary: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      note: 'Buy/sell zones are observation ranges for manual plan draft review only; they do not emit formal ADD / REDUCE.',
    },
  })
  await addJson('31_rolling_strategy_backtest_3y.json', 'Three-year rolling strategy backtest for dividend low-vol trading-zone models', {
    ...common(undefined, rollingStrategyBacktest.status === 'completed' ? [] : ['three-year rolling sample is insufficient for one or more strategies']),
    gitCommit,
    source: backtestInputResult.source,
    sourceError: backtestInputResult.error,
    rollingStrategyBacktest,
    modelBoundary: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      note: 'Rolling strategy result is research evidence. It does not unlock formal trade actions.',
    },
  })
  await addJson('07_validation_retest.json', 'Latest strategy-specific validation retest artifact', {
    ...common(undefined, latestValidation ? [] : ['latest validation retest artifact missing']),
    gitCommit,
    phase: 'Phase 7',
    status: latestValidation?.validationDecision?.usableForTradingAdvice === true ? 'passed' : 'insufficient',
    validationRetest: latestValidation,
    expandedSampleValidation,
    validationFailureTaxonomy: {
      schemaVersion: 'dividend.low_vol.validation_failure_taxonomy.v1',
      gates: [
        { id: 'out_of_sample', required: 'positive OOS and positive excess return', status: latestValidation?.validationEvidenceMatrix?.checks?.outOfSample?.status || 'missing' },
        { id: 'walk_forward', required: 'multiple windows with >=60% pass rate', status: latestValidation?.validationEvidenceMatrix?.checks?.walkForward?.status || 'missing' },
        { id: 'parameter_sensitivity', required: 'not insufficient and stable neighbor variants', status: latestValidation?.validationEvidenceMatrix?.checks?.parameterSensitivity?.status || 'missing' },
        { id: 'group_stability', required: 'industry/regime/liquidity groups sufficient', status: latestValidation?.validationEvidenceMatrix?.checks?.groupStability?.status || 'missing' },
        { id: 'total_return_backtest', required: 'free-source or official total-return benchmark and ex-dividend adjusted series', status: totalReturnValidationReady ? 'passed' : 'blocked' },
        { id: 'trade_constraints', required: 'limit-up/down and suspension daily state', status: 'blocked' },
      ],
    },
    note: 'Strategy-specific research validation is not formal trading validation.',
  })
  await addJson('validation_retest.json', 'Alias: validation retest audit for user review', {
    ...common(undefined, latestValidation ? [] : ['latest validation retest artifact missing']),
    gitCommit,
    status: latestValidation?.validationDecision?.usableForTradingAdvice === true ? 'passed' : 'insufficient',
    validationRetest: latestValidation,
    expandedSampleValidation,
    validationFailureTaxonomy: {
      gates: [
        { id: 'total_return_backtest', status: totalReturnValidationReady ? 'passed' : 'blocked' },
        { id: 'provider_ingestion', status: providerIngestionAudit.status },
        { id: 'runtime_health', status: runtimeHealth.status },
      ],
    },
    prohibitedActions: PROHIBITED_ACTIONS,
  })
  await addJson('14_expanded_sample_validation.json', 'Research-only expanded observation sample diagnostics', {
    ...common(undefined, expandedSampleValidation ? [] : ['expanded sample validation artifact missing']),
    gitCommit,
    status: expandedSampleValidation?.status || 'missing',
    expandedSampleValidation,
    conclusion: expandedSampleValidation?.status === 'expanded_sample_ready_for_research_validation'
      ? 'Near-miss observation pool has sufficient research sample and candidate-level validation, but strict candidate pool remains insufficient and trading actions stay blocked.'
      : 'Expanded observation pool is still insufficient; strategy family may require revised criteria or a new strategy family.',
  })
  await addJson('15_v2_research_validation.json', 'Research-only calibrated dividend_low_vol_leader_v2 validation artifact', {
    ...common(undefined, v2ResearchValidation ? [] : ['v2 research validation artifact missing']),
    gitCommit,
    status: v2ResearchValidation?.status || 'missing',
    v2ResearchValidation,
    conclusion: v2ResearchValidation?.status === 'research_candidate_passed'
      ? 'Calibrated v2 research rules have sufficient sample and candidate-level validation, but remain research-only and do not unlock trading actions.'
      : 'Calibrated v2 research rules are not yet sufficiently validated.',
  })
  await addJson('16_frontend_runtime_validation.json', 'Frontend runtime contract for persisted all-sample loading and V2 research-only visibility', {
    ...common(undefined, frontendRuntimeContract ? [] : ['frontend runtime contract artifact missing']),
    gitCommit,
    status: frontendRuntimeContract?.status || 'missing',
    frontendRuntimeContract,
    requiredContract: {
      defaultLoadMode: 'persisted_all_latest_by_symbol',
      defaultLimit: 6000,
      independentMenuRoute: '/dividend-low-vol',
      v2ResearchCardVisible: true,
      v2MayUnlockFormalTradeActions: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
    conclusion: frontendRuntimeContract?.status === 'passed'
      ? 'Frontend contract confirms the Dividend Low Vol page defaults to persisted all-sample data and keeps V2 research validation separate from trade action readiness.'
      : 'Frontend runtime contract is missing or failed; run npm run test:dividend-low-vol-frontend-runtime before relying on the UI audit.',
  })
  await addJson('17_formal_promotion_plan.json', 'Research-to-formal-validation promotion plan for dividend_low_vol_leader_v2_research', {
    ...common(undefined, formalPromotionPlan ? [] : ['formal promotion plan artifact missing']),
    gitCommit,
    status: formalPromotionPlan?.status || 'missing',
    formalPromotionPlan,
    conclusion: formalPromotionPlan?.status === 'manual_trade_draft_ready_auto_trade_blocked'
      ? 'V2 research evidence has been promoted to manual trade draft review only; formal ADD / REDUCE and AUTO_TRADE remain blocked.'
      : formalPromotionPlan?.status === 'research_candidate_passed_formal_validation_pending'
      ? 'V2 research passed and can be considered for formal validation promotion, but trade actions remain blocked.'
      : 'No promotable v2 research state is available yet.',
  })
  await addJson('18_manual_trade_draft_readiness.json', 'Manual trade draft readiness gate for the user-facing dividend-low-vol workflow', {
    ...common(undefined, manualTradeDraftReadiness.readyForManualTradeDraft ? [] : ['manual trade draft readiness is blocked']),
    gitCommit,
    status: manualTradeDraftReadiness.status,
    manualTradeDraftReadiness,
    conclusion: manualTradeDraftReadiness.readyForManualTradeDraft
      ? 'The strategy evidence is ready for manual trade plan draft review only. Formal ADD / REDUCE and AUTO_TRADE remain prohibited.'
      : 'Manual trade plan draft is not ready.',
  })
  await addJson('19_manual_trade_draft_user_path.json', 'User-facing manual trade draft path and top-three candidate audit', {
    ...common(undefined, manualTradeDraftReadiness.readyForManualTradeDraft ? [] : ['manual draft user path blocked']),
    gitCommit,
    status: manualTradeDraftUserPathAudit.status,
    manualTradeDraftUserPathAudit,
  })
  await addJson('20_persisted_manual_trade_draft.json', 'Latest user-triggered persisted manual trade draft artifact', {
    ...common(undefined, persistedManualTradeDraft ? [] : ['no persisted user-triggered manual trade draft artifact found']),
    gitCommit,
    status: persistedManualTradeDraft ? persistedManualTradeDraft.status : 'missing',
    persistedManualTradeDraft,
    safetyAssertions: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
  })
  await addJson('21_persisted_manual_trade_draft_review.json', 'Latest user-triggered persisted manual trade draft review artifact', {
    ...common(undefined, persistedManualTradeDraftReview ? [] : ['no persisted manual trade draft review artifact found']),
    gitCommit,
    status: persistedManualTradeDraftReview ? (persistedManualTradeDraftReview.decision || 'reviewed') : 'missing',
    persistedManualTradeDraftReview,
    safetyAssertions: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      reviewDoesNotCreateOrder: true,
    },
  })
  await addJson('22_manual_watchlist.json', 'Latest manual-review dividend low volatility observation watchlist artifact', {
    ...common(undefined, manualWatchlist ? [] : ['no manual watchlist artifact found']),
    gitCommit,
    status: manualWatchlist ? manualWatchlist.status : 'missing',
    manualWatchlist,
    safetyAssertions: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      watchlistDoesNotCreateOrder: true,
    },
  })
  await addJson('23_manual_pretrade_check.json', 'Latest manual pre-trade review checklist for the dividend low volatility watchlist', {
    ...common(undefined, manualPretradeCheck ? [] : ['no manual pretrade check artifact found']),
    gitCommit,
    status: manualPretradeCheck ? manualPretradeCheck.status : 'missing',
    manualPretradeCheck,
    safetyAssertions: {
      executionReady: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      checklistDoesNotCreateOrder: true,
    },
  })
  await addJson('24_manual_pretrade_review.json', 'Latest manual pre-trade review conclusion for the dividend low volatility watchlist', {
    ...common(undefined, manualPretradeReview ? [] : ['no manual pretrade review artifact found']),
    gitCommit,
    status: manualPretradeReview ? (manualPretradeReview.decision || 'reviewed') : 'missing',
    manualPretradeReview,
    safetyAssertions: {
      executionReady: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      reviewDoesNotCreateOrder: true,
    },
  })
  await addJson('25_manual_workflow_audit.json', 'Latest end-to-end manual dividend low volatility workflow audit chain', {
    ...common(undefined, manualWorkflowAudit.status === 'complete_observation_workflow' ? [] : ['manual workflow audit chain is partial']),
    gitCommit,
    status: manualWorkflowAudit.status,
    manualWorkflowAudit,
    safetyAssertions: {
      executionReady: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      workflowDoesNotCreateOrder: true,
    },
  })
  await addJson('26_validation_gap_diagnostics.json', 'Strategy validation gap diagnostics with affected gates and remediation actions', {
    ...common(undefined, validationGapDiagnostics.summary.blockingGapCount === 0 ? [] : ['formal validation still has blocking gaps']),
    gitCommit,
    status: validationGapDiagnostics.status,
    validationGapDiagnostics,
    safetyAssertions: {
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
      diagnosticsDoesNotCreateOrder: true,
    },
  })
  await addJson('27_manual_acceptance_review.json', 'Manual acceptance review checklist after this development stage', {
    schemaVersion: 'dividend.low_vol.manual_acceptance_review.v1',
    ...common(undefined, ['manual acceptance must review validation evidence source and safety boundary']),
    gitCommit,
    status: validationGapDiagnostics.summary.blockingGapCount === 0 ? 'ready_for_manual_acceptance_review' : 'manual_acceptance_required_with_open_validation_gaps',
    developmentStageCompleted: {
      validationGapRecorded: true,
      tradeConstraintSourceBreakdownRecorded: true,
      freeSourceTradeabilityPathValidated: totalReturnBacktestAudit.status === 'free_source_validation_ready',
      auditPackageRegenerated: true,
    },
    acceptanceChecklist: [
      {
        id: 'review_validation_gap_diagnostics',
        status: validationGapDiagnostics.summary.blockingGapCount === 0 ? 'passed' : 'requires_review',
        evidenceFile: '26_validation_gap_diagnostics.json',
        requiredHumanCheck: '确认剩余 validation gaps 是否可接受；不可接受时继续扩样本和重跑 validation retest。',
      },
      {
        id: 'confirm_free_source_tradeability_boundary',
        status: totalReturnBacktestAudit.status === 'free_source_validation_ready' ? 'passed' : 'requires_review',
        evidenceFile: '06_backtest_result.json',
        requiredHumanCheck: '确认免费源涨跌停/停牌约束只用于研究验证，不被标记为正式交易源。',
      },
      {
        id: 'confirm_manual_trade_draft_boundary',
        status: manualTradeDraftReadiness.readyForManualTradeDraft ? 'passed' : 'blocked',
        evidenceFile: '17_manual_trade_draft_readiness.json',
        requiredHumanCheck: '确认人工交易计划草案仍需人工确认，且不会创建正式 ADD / REDUCE 指令。',
      },
      {
        id: 'confirm_auto_trade_prohibited',
        status: 'passed',
        evidenceFile: '08_trade_gate_contract_audit.json',
        requiredHumanCheck: '确认 AUTO_TRADE 在所有路径中仍为 prohibited action。',
      },
    ],
    remainingValidationGaps: validationGapDiagnostics.gaps,
    decisionBoundary: {
      researchReady: dataReadinessAudit.gates.researchScanReady === true,
      freeSourceValidationAllowed: dataReadinessAudit.gates.freeSourceValidationAllowed === true,
      manualTradeDraftReady: manualTradeDraftReadiness.readyForManualTradeDraft === true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
    nextHumanReviewFocus: [
      '重点复核 26_validation_gap_diagnostics.json 中仍标记 formalValidationBlocked=true 的项。',
      '重点复核 06_backtest_result.json 中 tradeConstraintAudit.coverage.sourceQuality，确认免费源研究级边界。',
      '重点复核 17_manual_trade_draft_readiness.json 与 08_trade_gate_contract_audit.json，确认交易动作仍只进入人工草案。',
    ],
    safetyAssertions: {
      acceptanceReviewDoesNotCreateOrder: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
  })
  await addJson('28_manual_acceptance_decision.json', 'Latest user-triggered manual acceptance decision artifact', {
    ...common(undefined, manualAcceptanceDecision ? [] : ['no manual acceptance decision artifact found']),
    gitCommit,
    status: manualAcceptanceDecision ? (manualAcceptanceDecision.decision || 'reviewed') : 'missing',
    manualAcceptanceDecision,
    safetyAssertions: {
      acceptanceDecisionDoesNotCreateOrder: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
  })
  await addJson('29_end_to_end_user_path_audit.json', 'End-to-end user path audit from research evidence to manual acceptance decision', {
    schemaVersion: 'dividend.low_vol.end_to_end_user_path_audit.v1',
    ...common(undefined, manualWorkflowAudit.status === 'complete_observation_workflow' ? [] : ['manual workflow chain is not complete']),
    gitCommit,
    status: manualWorkflowAudit.status === 'complete_observation_workflow'
      ? 'complete_manual_review_path_no_execution'
      : 'partial_manual_review_path',
    stages: [
      {
        id: 'strategy_evidence',
        status: manualTradeDraftReadiness.readyForManualTradeDraft ? 'ready_for_manual_trade_draft' : manualTradeDraftReadiness.status,
        evidenceFile: '18_manual_trade_draft_readiness.json',
        artifactId: manualTradeDraftReadiness.latestEvidence?.operationId || null,
      },
      {
        id: 'manual_trade_draft',
        status: persistedManualTradeDraft?.status || 'missing',
        evidenceFile: '20_persisted_manual_trade_draft.json',
        artifactId: persistedManualTradeDraft?.draftId || null,
      },
      {
        id: 'manual_trade_draft_review',
        status: persistedManualTradeDraftReview?.decision || 'missing',
        evidenceFile: '21_persisted_manual_trade_draft_review.json',
        artifactId: persistedManualTradeDraftReview?.reviewId || null,
      },
      {
        id: 'manual_watchlist',
        status: manualWatchlist?.status || 'missing',
        evidenceFile: '22_manual_watchlist.json',
        artifactId: manualWatchlist?.watchlistId || null,
      },
      {
        id: 'manual_pretrade_check',
        status: manualPretradeCheck?.status || 'missing',
        evidenceFile: '23_manual_pretrade_check.json',
        artifactId: manualPretradeCheck?.checkId || null,
      },
      {
        id: 'manual_pretrade_review',
        status: manualPretradeReview?.decision || 'missing',
        evidenceFile: '24_manual_pretrade_review.json',
        artifactId: manualPretradeReview?.reviewId || null,
      },
      {
        id: 'manual_acceptance_decision',
        status: manualAcceptanceDecision?.decision || 'missing',
        evidenceFile: '28_manual_acceptance_decision.json',
        artifactId: manualAcceptanceDecision?.decisionId || null,
      },
    ],
    userOutcome: {
      canViewCandidates: true,
      canGenerateManualDraft: manualTradeDraftReadiness.readyForManualTradeDraft === true,
      canRecordManualReviews: true,
      canCreateOrder: false,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      prohibitedActions: PROHIBITED_ACTIONS,
    },
    nextHumanAction: manualAcceptanceDecision?.decision === 'accept_for_manual_draft_review'
      ? 'Continue manual review outside FAMS execution; FAMS still does not place orders.'
      : manualAcceptanceDecision?.decision === 'reject_acceptance'
        ? 'Keep strategy in observe-only state and do not use the draft.'
        : 'Review validation source, free-source boundary and portfolio risk before any external execution process.',
    notTradingAdvice: true,
  })
  await addJson('08_trade_gate_contract_audit.json', 'Trade gate contract and safety boundaries', {
    ...common(),
    gitCommit,
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
    assertions: [
      'candidate pool policy prohibits ADD / REDUCE / AUTO_TRADE',
      'factset tradingDiscipline prohibits ADD / REDUCE / AUTO_TRADE',
      'validation retest must not set usableForTradingAdvice=true while any gate is insufficient',
      'AUTO_TRADE remains prohibited',
    ],
    coverage: [
      'candidate_pool',
      'low_zone_alert',
      'build_plan_alert',
      'add_on_pullback_alert',
      'high_zone_alert',
      'trim_alert',
      'exit_risk_alert',
      'watchlist_or_research_adapter',
      'plan_draft',
      'manual_trade_draft_boundary',
      'llm_explanation_boundary',
    ],
    policy: pool.policy,
  })
  await addJson('09_alert_and_portfolio_linkage_audit.json', 'Alert and portfolio linkage audit', {
    ...common(undefined, ['portfolio risk checks are research-only and must not unlock formal actions']),
    gitCommit,
    phase: 'Phase 8',
    status: 'implemented_research_only',
    alerts: pool.candidates.flatMap((candidate) => candidate.alerts.map((alert) => ({
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      alertType: alert.type,
      triggerReason: alert.triggerReason,
      isHolding: candidate.positionContext.isHolding,
      currentWeight: candidate.positionContext.portfolioWeightPercent,
      researchTargetWeight: candidate.positionContext.researchTargetWeightPercent,
      formalTargetWeight: candidate.positionContext.formalTargetWeightPercent,
      singleStockCapPercent: candidate.tradingDiscipline.positionGuidance.singleStockCapPercent,
      industryCapPercent: candidate.tradingDiscipline.positionGuidance.industryCapPercent,
      portfolioRiskCheck: {
        singleStockCapBreached: (candidate.positionContext.portfolioWeightPercent || 0) > candidate.tradingDiscipline.positionGuidance.singleStockCapPercent,
        formalActionBlocked: candidate.tradingDiscipline.formalTradeActionAllowed === false,
        autoTradeBlocked: candidate.tradingDiscipline.autoTradeAllowed === false,
      },
      suppressedReason: candidate.blockedReasons,
      evidenceRefs: alert.evidenceRefs,
      prohibitedActions: candidate.tradingDiscipline.prohibitedActions,
    }))),
  })
  await addJson('10_frontend_visibility_audit.json', 'Frontend visibility and anti-misleading audit', {
    ...common(),
    gitCommit,
    phase: 'Phase 9',
    page: '/dividend-low-vol',
    requiredVisibleItems: [
      'research-only banner',
      'prohibited ADD / REDUCE / AUTO_TRADE',
      'candidate table',
      'rejection audit',
      'leader audit',
      'dividend risk flags',
      'data verification',
      'backtest diagnostics',
      'validation matrix',
      'trade gate status',
    ],
    status: 'implemented_pending_visual_review',
    antiMisleadingAssertions: [
      'low_zone_alert is presented as research/observation, not buy instruction',
      'PLAN_DRAFT requires manual review and validation gate',
      'validation insufficient must not display tradable status',
      'seed fallback is disclosed in leader audit',
    ],
  })
  await addJson('frontend_visibility_audit.json', 'Alias: frontend visibility audit for user review', {
    ...common(),
    gitCommit,
    page: '/dividend-low-vol',
    status: 'implemented_pending_visual_review',
    requiredVisibleItems: [
      'research-only banner',
      'prohibited actions',
      'leader evidence status',
      'data gaps',
      'rejection taxonomy',
      'backtest diagnostics',
      'validation matrix',
      'trade gate status',
    ],
  })
  await addJson('11_runtime_health_audit.json', 'Runtime and SQLite health audit', runtimeHealth)
  await addJson('runtime_health_audit.json', 'Alias: runtime health audit for user review', runtimeHealth)
  await addJson('12_development_tracker.json', 'Development tracker and audit backlog', {
    ...common(),
    gitCommit,
    tracker,
    auditBacklog,
  })
  await addJson('development_tracker.json', 'Alias: development tracker for user review', {
    ...common(),
    gitCommit,
    tracker,
    auditBacklog,
  })
  await addJson('13_gpt_plan_completion_audit.json', 'GPT execution plan completion status for current round', {
    schemaVersion: 'dividend.low_vol.gpt_plan_completion_audit.v2',
    ...common(undefined, [
      ...(runtimeHealth.status === 'healthy' ? [] : ['runtime_health_not_healthy_blocks_full_a_persistence']),
      ...(dataReadinessAudit.gates.researchScanReady ? [] : ['free_source_research_data_readiness_incomplete']),
      ...(totalReturnValidationReady ? [] : ['total_return_backtest_not_validation_ready']),
    ]),
    gitCommit,
    overallCompletion: {
      researchReady: runtimeHealth.status === 'healthy' && dataReadinessAudit.gates.researchScanReady ? 'free_source_research_ready' : 'blocked',
      tradeActionReady: manualTradeDraftReadiness.readyForManualTradeDraft ? 'manual_trade_draft_ready' : false,
      manualTradeDraftReady: manualTradeDraftReadiness.readyForManualTradeDraft,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      runtimeHealthStatus: runtimeHealth.status,
      providerIngestionStatus: providerIngestionAudit.status,
      dataReadinessStatus: dataReadinessAudit.status,
      dataProviderMode: dataReadinessAudit.providerMode,
      freeSourceResearchScanAllowed: dataReadinessAudit.gates.persistentFullAScanAllowed,
      freeSourceValidationAllowed: dataReadinessAudit.gates.freeSourceValidationAllowed,
      formalBlockers: dataReadinessAudit.formalBlockers,
      providerUpgradeBlockers: dataReadinessAudit.providerUpgradeBlockers,
      leaderEvidenceStatus: pool.candidates.some((candidate) => candidate.leaderEvidence?.status === 'verified_industry_leader') ? 'partial_verified_candidates' : 'no_verified_industry_leader',
      backtestFormalGrade: totalReturnBacktestAudit.status === 'formal_grade_ready',
      backtestFreeSourceValidationReady: totalReturnBacktestAudit.status === 'free_source_validation_ready',
      validationEvidenceStatus: latestValidation?.validationDecision?.usableForTradingAdvice === true ? 'passed' : 'insufficient',
      expandedSampleValidationStatus: expandedSampleValidation?.status || 'missing',
      expandedSampleEffectivePathCount: expandedSampleValidation?.backtest?.sample?.effectivePathCount ?? null,
      v2ResearchValidationStatus: v2ResearchValidation?.status || 'missing',
      v2ResearchEffectivePathCount: v2ResearchValidation?.backtest?.sample?.effectivePathCount ?? null,
      frontendRuntimeContractStatus: frontendRuntimeContract?.status || 'missing',
      formalPromotionPlanStatus: formalPromotionPlan?.status || 'missing',
      manualTradeDraftReadinessStatus: manualTradeDraftReadiness.status,
      manualTradeDraftReviewStatus: persistedManualTradeDraftReview?.decision || 'missing',
      manualWatchlistStatus: manualWatchlist?.status || 'missing',
      manualPretradeCheckStatus: manualPretradeCheck?.status || 'missing',
      manualPretradeReviewStatus: manualPretradeReview?.decision || 'missing',
      manualAcceptanceDecisionStatus: manualAcceptanceDecision?.decision || 'missing',
      manualWorkflowAuditStatus: manualWorkflowAudit.status,
      validationGapDiagnosticsStatus: validationGapDiagnostics.status,
      validationGapBlockingCount: validationGapDiagnostics.summary.blockingGapCount,
    },
    phaseCompletion: [
      { phase: 'A', name: 'Runtime Health Closure', status: runtimeHealth.status === 'healthy' ? 'healthy' : 'blocked_critical_or_unconfirmed' },
      { phase: 'B', name: 'Provider Ingestion Skeleton', status: providerIngestionAudit.status },
      { phase: 'C', name: 'Industry Leader Evidence Upgrade', status: pool.candidates.some((candidate) => candidate.leaderEvidence?.status === 'verified_industry_leader') ? 'partial' : 'blocked_no_verified_leader' },
      { phase: 'D', name: 'Dividend Total Return Backtest Upgrade', status: totalReturnBacktestAudit.status },
      { phase: 'E', name: 'Formal Validation Retest', status: latestValidation?.validationDecision?.usableForTradingAdvice === true ? 'passed' : 'insufficient' },
      { phase: 'E2', name: 'Expanded Observation Sample Diagnostics', status: expandedSampleValidation?.status || 'missing' },
      { phase: 'E3', name: 'Calibrated V2 Research Validation', status: v2ResearchValidation?.status || 'missing' },
      { phase: 'E4', name: 'Formal Promotion Plan', status: formalPromotionPlan?.status || 'missing' },
      { phase: 'F2', name: 'Frontend Runtime Contract', status: frontendRuntimeContract?.status || 'missing' },
      { phase: 'F3', name: 'Manual Trade Draft Readiness', status: manualTradeDraftReadiness.status },
      { phase: 'F4', name: 'Manual Trade Draft Review Artifact', status: persistedManualTradeDraftReview ? (persistedManualTradeDraftReview.decision || 'reviewed') : 'missing' },
      { phase: 'F5', name: 'Manual Watchlist Artifact', status: manualWatchlist ? manualWatchlist.status : 'missing' },
      { phase: 'F6', name: 'Manual Pretrade Check Artifact', status: manualPretradeCheck ? manualPretradeCheck.status : 'missing' },
      { phase: 'F7', name: 'Manual Pretrade Review Artifact', status: manualPretradeReview ? (manualPretradeReview.decision || 'reviewed') : 'missing' },
      { phase: 'F8', name: 'Manual Acceptance Decision Artifact', status: manualAcceptanceDecision ? (manualAcceptanceDecision.decision || 'reviewed') : 'missing' },
      { phase: 'F9', name: 'Manual Workflow Audit Chain', status: manualWorkflowAudit.status },
      { phase: 'G1', name: 'Validation Gap Diagnostics', status: validationGapDiagnostics.status },
      { phase: 'F', name: 'Audit Package & Frontend Recheck', status: 'completed_audit_package_generated_visual_review_pending_real_data' },
    ],
    nextBlockers: [
      ...(runtimeHealth.status === 'healthy' ? [] : ['Close runtime health before full-A persistent scan/backtest.']),
      ...(dataReadinessAudit.gates.researchScanReady ? [] : ['Restore free-source canonical, market bars, features, security status and tradeability coverage before research scan.']),
      ...(dataReadinessAudit.providerUpgradeBlockers.length > 0 ? [`Optional provider upgrade remains pending: ${dataReadinessAudit.providerUpgradeBlockers.join(', ')}.`] : []),
      ...(totalReturnValidationReady ? [] : ['Wire free-source or official total-return benchmark, ex-dividend adjusted series, limit-up/down and suspension state.']),
      ...(expandedSampleValidation?.status === 'expanded_sample_ready_for_research_validation'
        ? ['Strict candidate pool remains too small and OOS failed; expanded queue is research-only and cannot unlock trading.']
        : ['Run expanded observation sample diagnostics to decide whether the strategy family requires revised criteria.']),
      ...(v2ResearchValidation?.status === 'research_candidate_passed'
        ? ['Prepare a separate v2 UI/API research surface and formal validation promotion plan; do not map v2 research result to ADD / REDUCE.']
        : ['Run calibrated v2 research validation before proposing v2 as a research-only strategy surface.']),
      ...(frontendRuntimeContract?.status === 'passed'
        ? []
        : ['Run frontend runtime contract verification so the UI defaults to persisted all-sample data and does not trigger slow provider rebuilds.']),
      ...(formalPromotionPlan?.status === 'research_candidate_passed_formal_validation_pending'
        ? ['Promote v2 only through a separate formal validation retest; keep trade gate blocked until usableForTradingAdvice=true.']
        : formalPromotionPlan?.status === 'manual_trade_draft_ready_auto_trade_blocked'
        ? []
        : ['Generate a formal promotion plan after v2 research validation passes.']),
      ...(manualTradeDraftReadiness.readyForManualTradeDraft
        ? []
        : ['Close manual trade draft readiness gate before presenting draft workflow as ready.']),
    ],
  })
  const bestRollingStrategy = rollingStrategyBacktest.strategyResults.find((item) => item.strategyId === rollingStrategyBacktest.conclusion.bestStrategyId)
  await addText('SUMMARY_FOR_GPT.md', 'Self-contained summary for GPT review', `# Summary For GPT\n\nGeneratedAt: ${GENERATED_AT}\n\nThis package audits \`${STRATEGY_ID}\` as a manual-review-only dividend low volatility strategy.\n\nCurrent allowed actions: ${manualTradeDraftReadiness.allowedActions.join(', ')}.\n\nCurrent prohibited actions: ${PROHIBITED_ACTIONS.join(', ')}.\n\nCandidate source: ${poolResult.source}.\n\nResearch-ready: ${runtimeHealth.status === 'healthy' && dataReadinessAudit.gates.researchScanReady ? 'free_source_research_ready' : 'blocked'}.\n\nFree-source validation allowed: ${dataReadinessAudit.gates.freeSourceValidationAllowed}.\n\nManualTradeDraftReady: ${manualTradeDraftReadiness.readyForManualTradeDraft}.\n\nTrade-action-ready for this strategy: ${manualTradeDraftReadiness.readyForManualTradeDraft ? 'manual_trade_draft_ready_only' : 'false'}.\n\nFormalTradingUnlocked: false.\n\nAutoTradeUnlocked: false.\n\nRuntime Health: ${runtimeHealth.status}.\n\nProvider Ingestion: ${providerIngestionAudit.status}.\n\nData Readiness: ${dataReadinessAudit.status}.\n\nData Provider Mode: ${dataReadinessAudit.providerMode}.\n\nFree-source research scan allowed: ${dataReadinessAudit.gates.persistentFullAScanAllowed}.\n\nFormal blockers: ${dataReadinessAudit.formalBlockers.length > 0 ? dataReadinessAudit.formalBlockers.join(', ') : 'none'}.\n\nOptional provider upgrade blockers: ${dataReadinessAudit.providerUpgradeBlockers.length > 0 ? dataReadinessAudit.providerUpgradeBlockers.join(', ') : 'none'}.\n\nLeader Evidence: ${pool.candidates.some((candidate) => candidate.leaderEvidence?.status === 'verified_industry_leader') ? 'partial_verified_candidates' : 'no_verified_industry_leader'}.\n\nBacktest validation-ready: ${totalReturnValidationReady}.\n\nBacktest free-source validation-ready: ${totalReturnBacktestAudit.status === 'free_source_validation_ready'}.\n\nBacktest formal-grade: ${totalReturnBacktestAudit.status === 'formal_grade_ready'}.\n\nTrading-zone models: ${tradingZoneAudit.zones.length} candidate zones generated; models=布林低吸高抛, 股息率分位+长期均线.\n\nThree-year rolling model backtest: ${rollingStrategyBacktest.status}; best=${bestRollingStrategy?.label || 'none'}; winRate=${bestRollingStrategy?.metrics.winRatePercent ?? 'n/a'}%; totalReturn=${bestRollingStrategy?.metrics.totalReturnPercent ?? 'n/a'}%; researchPassed=${rollingStrategyBacktest.conclusion.researchPassed}.\n\nStrict Validation Evidence: ${latestValidation?.validationDecision?.usableForTradingAdvice === true ? 'passed' : 'insufficient'}.\n\nExpanded Observation Sample: ${expandedSampleValidation?.status || 'missing'}; effectivePathCount=${expandedSampleValidation?.backtest?.sample?.effectivePathCount ?? 'n/a'}.\n\nV2 Research Validation: ${v2ResearchValidation?.status || 'missing'}; effectivePathCount=${v2ResearchValidation?.backtest?.sample?.effectivePathCount ?? 'n/a'}.\n\nManual Draft Evidence: ${manualTradeDraftReadiness.status}; sample=${manualTradeDraftReadiness.latestEvidence?.bestSampleSize ?? 'n/a'}; cache=${manualTradeDraftReadiness.latestEvidence?.cacheHitRate ?? 'n/a'}; coverage=${manualTradeDraftReadiness.latestEvidence?.scanCoveragePercent ?? 'n/a'}.\n\nFrontend Runtime Contract: ${frontendRuntimeContract?.status || 'missing'}.\n\n${poolResult.error ? `Database read failed and fixture fallback was used: ${poolResult.error}\n\n` : ''}Key audit focus:\n\n1. Verify runtime health before any large scan.\n2. Confirm free-source research readiness before persistent research scans.\n3. Confirm free-source validation is allowed without Tushare.\n4. Confirm buy/sell zones are observation ranges, not formal ADD / REDUCE.\n5. Confirm rolling strategy backtest does not unlock formal trading actions.\n6. Confirm Tushare/formal provider gaps are optional provider upgrade blockers, not validation blockers.\n7. Confirm total-return validation can use free-source benchmark and tradeability facts, without labeling it formal-grade.\n8. Confirm rejection reasons are separated into data gaps, hard rule failures, risk flags and validation blockers.\n9. Confirm seed fallback is not treated as verified industry leadership.\n10. Confirm formal ADD / REDUCE / AUTO_TRADE remain prohibited.\n`)

  const manifestEntries = []
  for (const artifact of artifacts) {
    const info = await stat(artifact.path)
    manifestEntries.push({
      fileName: artifact.fileName,
      purpose: artifact.purpose,
      sizeBytes: info.size,
      sha256: await sha256(artifact.path),
    })
  }
  const manifest = {
    schemaVersion: 'dividend.low_vol.standard_gpt_audit_manifest.v1',
    ...common(),
    gitCommit,
    packageDir: dir,
    files: manifestEntries,
    privacy: {
      excludesEnv: true,
      excludesRawDatabase: true,
      excludesTokensCookiesSecrets: true,
      note: 'Generated package contains derived research/audit artifacts only.',
    },
  }
  const manifestPath = await writeJson(dir, 'manifest.json', manifest)
  console.log(JSON.stringify({
    ok: true,
    packageDir: dir,
    manifestPath,
    candidateSource: poolResult.source,
    fileCount: manifestEntries.length + 1,
    prohibitedActions: PROHIBITED_ACTIONS,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode || 0)
  })
