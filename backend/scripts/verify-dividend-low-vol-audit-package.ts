import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { buildDividendLowVolRejectionAudit } from '../src/services/dividend-low-vol/dividendLowVolRejectionTaxonomy.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import type { DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

const execFileAsync = promisify(execFile)

function history(start: number, days: number, drift: number) {
  const rows = []
  const startDate = new Date('2025-01-01T00:00:00.000Z')
  for (let index = 0; index < days; index += 1) {
    const close = start + (index * drift) + Math.sin(index / 11) * 0.2
    rows.push({
      date: new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.01,
      low: close * 0.98,
      close,
      volume: 6_000_000,
      amount: close * 6_000_000,
    })
  }
  return rows
}

const inputs: DividendLowVolInput[] = [
  {
    symbol: '000001',
    name: '平安银行',
    industry: '银行',
    listingAgeDays: 365 * 10,
    price: 8,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.9, evidenceRef: 'verify:000001:dividend:2023' },
      { year: 2024, dividendPerShare: 0.7, evidenceRef: 'verify:000001:dividend:2024' },
      { year: 2025, dividendPerShare: 0.45, evidenceRef: 'verify:000001:dividend:2025' },
    ],
    ttmDividendPerShare: 0.8,
    payoutRatio: 120,
    operatingCashFlowToNetProfit: 0.4,
    leaderScore: 80,
    avgTurnoverAmount60: 500_000_000,
    totalMarketCap: 180_000_000_000,
    history: history(12, 300, -0.04),
    evidenceRefs: ['verify:000001:source'],
  },
  {
    symbol: '600000',
    name: '浦发银行',
    industry: '银行',
    listingAgeDays: 365 * 10,
    price: 10,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.6, evidenceRef: 'verify:600000:dividend:2023' },
      { year: 2024, dividendPerShare: 0.7, evidenceRef: 'verify:600000:dividend:2024' },
      { year: 2025, dividendPerShare: 0.8, evidenceRef: 'verify:600000:dividend:2025' },
    ],
    ttmDividendPerShare: 0.8,
    payoutRatio: 50,
    operatingCashFlowToNetProfit: 1.2,
    leaderScore: 60,
    avgTurnoverAmount60: 500_000_000,
    totalMarketCap: 180_000_000_000,
    history: history(10, 140, -0.004),
    evidenceRefs: ['verify:600000:source'],
  },
]

async function main() {
  const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
  const audit = buildDividendLowVolRejectionAudit(pool.candidates)
  assert.ok(audit.byType.risk_flag.some((item) => item.reason === 'dividend_trap_risk'), 'dividend_trap_risk must be risk_flag')
  assert.ok(!audit.byType.data_gap.some((item) => item.reason === 'dividend_trap_risk'), 'dividend_trap_risk must not be data_gap')
  assert.ok(audit.byType.hard_rule_failure.some((item) => item.reason === 'max_drawdown_250d_above_35'), 'max drawdown must be hard_rule_failure')
  assert.ok(!audit.byType.data_gap.some((item) => item.reason === 'max_drawdown_250d_above_35'), 'max drawdown must not be data_gap')
  assert.ok(audit.byType.data_gap.some((item) => item.reason === 'industry_leader_score_below_75'), 'leader score with incomplete rank evidence must be data_gap')
  assert.deepEqual(pool.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(pool.candidates.every((candidate) => candidate.leaderEvidence), 'candidates must expose leaderEvidence')
  assert.ok(pool.candidates.every((candidate) => candidate.leaderEvidence.status !== 'verified_industry_leader'), 'fixture must not fake verified industry leader without cross-check refs')
  assert.ok(pool.candidates.every((candidate) => !candidate.alerts.some((alert) => alert.type === 'DIVIDEND_BUILD_PLAN')), 'build plan must not be emitted without verified industry leader')
  assert.ok(pool.candidates.every((candidate) => candidate.dividend.sourceRefs), 'dividend factset must expose sourceRefs')

  const backendDir = resolve(process.cwd())
  const health = await execFileAsync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/check-sqlite-health.ts'], {
    cwd: backendDir,
    timeout: 120000,
  })
  const healthOutput = JSON.parse(health.stdout)
  assert.ok(healthOutput.path.endsWith('11_runtime_health_audit.json'), 'health script must write runtime audit')
  const healthAudit = JSON.parse(await readFile(healthOutput.path, 'utf8'))
  assert.equal(healthAudit.schemaVersion, 'dividend.low_vol.runtime_health_audit.v1')
  assert.deepEqual(healthAudit.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(typeof healthAudit.decision.largeDividendLowVolScanAllowed, 'boolean')

  const generated = await execFileAsync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/generate-dividend-low-vol-audit-package.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      FAMS_DIVIDEND_LOW_VOL_AUDIT_FAST: '1',
    },
    timeout: 120000,
  })
  const generatedOutput = JSON.parse(generated.stdout)
  const manifest = JSON.parse(await readFile(generatedOutput.manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 'dividend.low_vol.standard_gpt_audit_manifest.v1')
  assert.ok(manifest.files.some((file: any) => file.fileName === '02_rejection_audit.json'), 'manifest must include rejection audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '11_runtime_health_audit.json'), 'manifest must include runtime health audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '14_expanded_sample_validation.json'), 'manifest must include expanded sample validation audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '15_v2_research_validation.json'), 'manifest must include v2 research validation audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '16_frontend_runtime_validation.json'), 'manifest must include frontend runtime validation audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '17_formal_promotion_plan.json'), 'manifest must include formal promotion plan audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '18_manual_trade_draft_readiness.json'), 'manifest must include manual trade draft readiness audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '19_manual_trade_draft_user_path.json'), 'manifest must include manual trade draft user path audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '20_persisted_manual_trade_draft.json'), 'manifest must include persisted manual trade draft audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '21_persisted_manual_trade_draft_review.json'), 'manifest must include persisted manual trade draft review audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '22_manual_watchlist.json'), 'manifest must include manual watchlist audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '23_manual_pretrade_check.json'), 'manifest must include manual pretrade check audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '24_manual_pretrade_review.json'), 'manifest must include manual pretrade review audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '25_manual_workflow_audit.json'), 'manifest must include manual workflow audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '26_validation_gap_diagnostics.json'), 'manifest must include validation gap diagnostics audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '27_manual_acceptance_review.json'), 'manifest must include manual acceptance review audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '28_manual_acceptance_decision.json'), 'manifest must include manual acceptance decision audit')
  assert.ok(manifest.files.some((file: any) => file.fileName === '29_end_to_end_user_path_audit.json'), 'manifest must include end-to-end user path audit')
  assert.ok(manifest.files.every((file: any) => typeof file.sha256 === 'string' && file.sha256.length === 64), 'manifest files must include sha256')
  assert.deepEqual(manifest.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  const rejection = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '02_rejection_audit.json'), 'utf8'))
  assert.ok(rejection.byType, 'standard package rejection audit must expose byType')
  const leader = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '03_leader_evidence_audit.json'), 'utf8'))
  assert.ok(['partial', 'blocked'].includes(leader.status), 'leader audit must report phase status')
  const verifiedLeaders = leader.candidates.filter((candidate: any) => candidate.status === 'verified_industry_leader')
  assert.ok(verifiedLeaders.every((candidate: any) => (
    candidate.leaderEvidence?.marketCapRankVerified
    && candidate.leaderEvidence?.revenueRankVerified
    && candidate.leaderEvidence?.netProfitRankVerified
    && candidate.leaderEvidence?.roePercentileVerified
    && candidate.leaderEvidence?.providerCrossCheckedIndustryRank
    && Array.isArray(candidate.leaderEvidence?.evidenceRefs)
    && candidate.leaderEvidence.evidenceRefs.some((ref: string) => ref.includes('free-source-industry-rank'))
  )), 'verified industry leaders must have free-source rank evidence and must not be seed-only')
  assert.ok(leader.candidates.every((candidate: any) => (
    candidate.status !== 'verified_industry_leader' || candidate.leaderEvidence?.seedFallbackUsed !== true
  )), 'seed fallback must not be marked verified_industry_leader')
  const dividend = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '04_dividend_factset_audit.json'), 'utf8'))
  assert.ok(dividend.candidates.every((candidate: any) => candidate.dividend.sourceRefs), 'dividend audit must expose sourceRefs')
  const backtest = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '06_backtest_result.json'), 'utf8'))
  assert.ok(['research_only_proxy_blocked', 'research_only_insufficient', 'free_source_validation_ready'].includes(backtest.status), 'backtest audit must expose current validation-readiness status')
  assert.notEqual(backtest.status, 'formal_grade_ready', 'free-source validation must not be mislabeled as formal-grade')
  assert.equal(typeof backtest.backtest.metrics.capitalGainContributionPercent, 'number')
  const provider = JSON.parse(await readFile(resolve(generatedOutput.packageDir, 'provider_ingestion_audit.json'), 'utf8'))
  assert.equal(provider.schemaVersion, 'dividend.low_vol.provider_ingestion_audit.v1')
  assert.equal(provider.decision.canMarkProviderFallbackVerified, false)
  assert.ok(provider.fieldContracts.some((item: any) => item.field === 'stk_limit_limit_up_down'))
  const totalReturn = JSON.parse(await readFile(resolve(generatedOutput.packageDir, 'dividend_total_return_backtest.json'), 'utf8'))
  assert.equal(totalReturn.schemaVersion, 'dividend.low_vol.total_return_backtest_audit.v1')
  assert.notEqual(totalReturn.status, 'formal_grade_ready', 'free-source total-return audit must not be formal-grade')
  const validation = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '07_validation_retest.json'), 'utf8'))
  assert.ok(validation.validationFailureTaxonomy, 'validation audit must expose failure taxonomy')
  const tradeGate = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '08_trade_gate_contract_audit.json'), 'utf8'))
  assert.equal(tradeGate.formalTradeActionAllowed, false)
  assert.equal(tradeGate.autoTradeAllowed, false)
  assert.ok(tradeGate.coverage.includes('llm_explanation_boundary'))
  const alertAudit = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '09_alert_and_portfolio_linkage_audit.json'), 'utf8'))
  assert.equal(alertAudit.status, 'implemented_research_only')
  const frontend = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '10_frontend_visibility_audit.json'), 'utf8'))
  assert.ok(frontend.antiMisleadingAssertions.length >= 3)
  const completion = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '13_gpt_plan_completion_audit.json'), 'utf8'))
  assert.equal(completion.schemaVersion, 'dividend.low_vol.gpt_plan_completion_audit.v2')
  assert.equal(completion.overallCompletion.formalTradingUnlocked, false)
  assert.equal(completion.overallCompletion.autoTradeUnlocked, false)
  const expandedSample = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '14_expanded_sample_validation.json'), 'utf8'))
  assert.equal(expandedSample.validationDecision?.prohibitedActions?.includes('AUTO_TRADE') ?? true, true)
  assert.notEqual(expandedSample.status, 'formal_trading_unlocked')
  const v2Research = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '15_v2_research_validation.json'), 'utf8'))
  assert.equal(v2Research.v2ResearchValidation?.validationDecision?.usableForTradingAdvice, false)
  assert.ok(v2Research.v2ResearchValidation?.validationDecision?.prohibitedActions?.includes('ADD'))
  const frontendRuntime = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '16_frontend_runtime_validation.json'), 'utf8'))
  assert.equal(frontendRuntime.frontendRuntimeContract?.status, 'passed')
  assert.equal(frontendRuntime.frontendRuntimeContract?.frontend?.defaultLoadMode, 'persisted_all_latest_by_symbol')
  assert.equal(frontendRuntime.frontendRuntimeContract?.frontend?.defaultLimit, 6000)
  assert.equal(frontendRuntime.frontendRuntimeContract?.v2ResearchValidation?.usableForTradingAdvice, false)
  assert.ok(frontendRuntime.frontendRuntimeContract?.v2ResearchValidation?.prohibitedActions?.includes('AUTO_TRADE'))
  const promotionPlan = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '17_formal_promotion_plan.json'), 'utf8'))
  assert.equal(typeof promotionPlan.formalPromotionPlan?.validationDecision?.usableForTradingAdvice, 'boolean')
  assert.ok(promotionPlan.formalPromotionPlan?.validationDecision?.prohibitedActions?.includes('REDUCE'))
  assert.ok(promotionPlan.formalPromotionPlan?.validationDecision?.prohibitedActions?.includes('AUTO_TRADE'))
  const manualDraft = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '18_manual_trade_draft_readiness.json'), 'utf8'))
  assert.equal(manualDraft.manualTradeDraftReadiness?.formalTradeActionAllowed, false)
  assert.equal(manualDraft.manualTradeDraftReadiness?.autoTradeAllowed, false)
  assert.ok(manualDraft.manualTradeDraftReadiness?.prohibitedActions?.includes('ADD'))
  assert.ok(manualDraft.manualTradeDraftReadiness?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualDraft.manualTradeDraftReadiness?.prohibitedActions?.includes('AUTO_TRADE'))
  const manualUserPath = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '19_manual_trade_draft_user_path.json'), 'utf8'))
  assert.equal(manualUserPath.manualTradeDraftUserPathAudit?.formalTradeActionAllowed, false)
  assert.equal(manualUserPath.manualTradeDraftUserPathAudit?.autoTradeAllowed, false)
  assert.ok(manualUserPath.manualTradeDraftUserPathAudit?.prohibitedActions?.includes('AUTO_TRADE'))
  assert.ok(manualUserPath.manualTradeDraftUserPathAudit?.top3?.length <= 3)
  const persistedManualDraft = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '20_persisted_manual_trade_draft.json'), 'utf8'))
  assert.equal(persistedManualDraft.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(persistedManualDraft.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(persistedManualDraft.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  const persistedManualDraftReview = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '21_persisted_manual_trade_draft_review.json'), 'utf8'))
  assert.equal(persistedManualDraftReview.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(persistedManualDraftReview.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(persistedManualDraftReview.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(persistedManualDraftReview.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(persistedManualDraftReview.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  if (persistedManualDraftReview.persistedManualTradeDraftReview) {
    assert.equal(persistedManualDraftReview.persistedManualTradeDraftReview.formalTradeActionAllowed, false)
    assert.equal(persistedManualDraftReview.persistedManualTradeDraftReview.autoTradeAllowed, false)
    assert.ok(persistedManualDraftReview.persistedManualTradeDraftReview.prohibitedActions?.includes('AUTO_TRADE'))
  }
  const manualWatchlist = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '22_manual_watchlist.json'), 'utf8'))
  assert.equal(manualWatchlist.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualWatchlist.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualWatchlist.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualWatchlist.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualWatchlist.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  if (manualWatchlist.manualWatchlist) {
    assert.equal(manualWatchlist.manualWatchlist.formalTradeActionAllowed, false)
    assert.equal(manualWatchlist.manualWatchlist.autoTradeAllowed, false)
    assert.ok(manualWatchlist.manualWatchlist.prohibitedActions?.includes('AUTO_TRADE'))
    assert.ok((manualWatchlist.manualWatchlist.entries || []).every((entry: any) => entry.formalTargetWeightPercent === 0))
  }
  const manualPretradeCheck = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '23_manual_pretrade_check.json'), 'utf8'))
  assert.equal(manualPretradeCheck.safetyAssertions?.executionReady, false)
  assert.equal(manualPretradeCheck.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualPretradeCheck.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualPretradeCheck.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualPretradeCheck.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualPretradeCheck.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  if (manualPretradeCheck.manualPretradeCheck) {
    assert.equal(manualPretradeCheck.manualPretradeCheck.executionReady, false)
    assert.equal(manualPretradeCheck.manualPretradeCheck.formalTradeActionAllowed, false)
    assert.equal(manualPretradeCheck.manualPretradeCheck.autoTradeAllowed, false)
    assert.ok(manualPretradeCheck.manualPretradeCheck.prohibitedActions?.includes('AUTO_TRADE'))
    assert.ok((manualPretradeCheck.manualPretradeCheck.entries || []).every((entry: any) => entry.executionReady === false))
  }
  const manualPretradeReview = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '24_manual_pretrade_review.json'), 'utf8'))
  assert.equal(manualPretradeReview.safetyAssertions?.executionReady, false)
  assert.equal(manualPretradeReview.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualPretradeReview.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualPretradeReview.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualPretradeReview.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualPretradeReview.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  if (manualPretradeReview.manualPretradeReview) {
    assert.equal(manualPretradeReview.manualPretradeReview.executionReady, false)
    assert.equal(manualPretradeReview.manualPretradeReview.formalTradeActionAllowed, false)
    assert.equal(manualPretradeReview.manualPretradeReview.autoTradeAllowed, false)
    assert.ok(manualPretradeReview.manualPretradeReview.prohibitedActions?.includes('AUTO_TRADE'))
    assert.notEqual(manualPretradeReview.manualPretradeReview.decision, 'approve_execute')
  }
  const manualWorkflow = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '25_manual_workflow_audit.json'), 'utf8'))
  assert.equal(manualWorkflow.safetyAssertions?.executionReady, false)
  assert.equal(manualWorkflow.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualWorkflow.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualWorkflow.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualWorkflow.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualWorkflow.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  assert.ok(Array.isArray(manualWorkflow.manualWorkflowAudit?.stages))
  assert.equal(manualWorkflow.manualWorkflowAudit.summary?.executionReady, false)
  assert.equal(manualWorkflow.manualWorkflowAudit.summary?.formalTradeActionAllowed, false)
  assert.equal(manualWorkflow.manualWorkflowAudit.summary?.autoTradeAllowed, false)
  assert.ok(manualWorkflow.manualWorkflowAudit.stages.some((stage: any) => stage.id === 'manual_trade_draft'))
  assert.ok(manualWorkflow.manualWorkflowAudit.stages.some((stage: any) => stage.id === 'manual_pretrade_review'))
  assert.ok(manualWorkflow.manualWorkflowAudit.stages.some((stage: any) => stage.id === 'manual_acceptance_decision'))
  assert.ok(manualWorkflow.manualWorkflowAudit.stages.every((stage: any) => stage.formalTradeActionAllowed === false && stage.autoTradeAllowed === false))
  const validationGapDiagnostics = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '26_validation_gap_diagnostics.json'), 'utf8'))
  assert.equal(validationGapDiagnostics.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(validationGapDiagnostics.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(validationGapDiagnostics.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(validationGapDiagnostics.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(validationGapDiagnostics.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  assert.equal(validationGapDiagnostics.validationGapDiagnostics?.notTradingAdvice, true)
  assert.ok(Array.isArray(validationGapDiagnostics.validationGapDiagnostics?.gaps))
  assert.equal(typeof validationGapDiagnostics.validationGapDiagnostics?.summary?.blockingGapCount, 'number')
  assert.ok(validationGapDiagnostics.validationGapDiagnostics?.prohibitedActions?.includes('AUTO_TRADE'))
  const manualAcceptanceReview = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '27_manual_acceptance_review.json'), 'utf8'))
  assert.equal(manualAcceptanceReview.schemaVersion, 'dividend.low_vol.manual_acceptance_review.v1')
  assert.equal(manualAcceptanceReview.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualAcceptanceReview.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualAcceptanceReview.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualAcceptanceReview.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualAcceptanceReview.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  const manualAcceptanceDecision = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '28_manual_acceptance_decision.json'), 'utf8'))
  assert.equal(manualAcceptanceDecision.safetyAssertions?.formalTradeActionAllowed, false)
  assert.equal(manualAcceptanceDecision.safetyAssertions?.autoTradeAllowed, false)
  assert.ok(manualAcceptanceDecision.safetyAssertions?.prohibitedActions?.includes('ADD'))
  assert.ok(manualAcceptanceDecision.safetyAssertions?.prohibitedActions?.includes('REDUCE'))
  assert.ok(manualAcceptanceDecision.safetyAssertions?.prohibitedActions?.includes('AUTO_TRADE'))
  const endToEndUserPath = JSON.parse(await readFile(resolve(generatedOutput.packageDir, '29_end_to_end_user_path_audit.json'), 'utf8'))
  assert.equal(endToEndUserPath.userOutcome?.canCreateOrder, false)
  assert.equal(endToEndUserPath.userOutcome?.formalTradeActionAllowed, false)
  assert.equal(endToEndUserPath.userOutcome?.autoTradeAllowed, false)
  assert.ok(endToEndUserPath.userOutcome?.prohibitedActions?.includes('ADD'))
  assert.ok(endToEndUserPath.userOutcome?.prohibitedActions?.includes('REDUCE'))
  assert.ok(endToEndUserPath.userOutcome?.prohibitedActions?.includes('AUTO_TRADE'))

  console.log(JSON.stringify({
    ok: true,
    rejectionTypes: Object.fromEntries(Object.entries(audit.byType).map(([key, value]) => [key, (value as any[]).length])),
    health: {
      status: healthAudit.status,
      path: healthOutput.path,
    },
    package: {
      path: generatedOutput.packageDir,
      fileCount: generatedOutput.fileCount,
      candidateSource: generatedOutput.candidateSource,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
