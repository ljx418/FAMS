import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { fivdRInterventionService } from '../src/services/analysis/fivdRInterventionService.js'
import { alertService } from '../src/services/alert/alertService.js'

function assertNoTradeAllowed(result: any, label: string) {
  assert.equal(result.autoTradeAllowed, false, `${label} must keep autoTradeAllowed=false`)
  assert.equal(result.formalTradeActionAllowed, false, `${label} must keep formalTradeActionAllowed=false`)
  assert.ok(result.summary?.prohibitedActions?.includes('AUTO_TRADE') || result.prohibitedActions?.includes('AUTO_TRADE'), `${label} must prohibit AUTO_TRADE`)
  assert.ok(result.summary?.prohibitedActions?.includes('ADD') || result.prohibitedActions?.includes('ADD'), `${label} must prohibit ADD`)
  assert.ok(result.summary?.prohibitedActions?.includes('REDUCE') || result.prohibitedActions?.includes('REDUCE'), `${label} must prohibit REDUCE`)
}

async function verifyPortfolioSummary() {
  const summary = await analysisService.getFivdRPortfolioSummary('default') as any
  assert.equal(summary.schemaVersion, 'fivd.r.analysis.result.v1')
  assert.equal(summary.scope, 'portfolio')
  assert.ok(Array.isArray(summary.dataGapSummary), 'portfolio summary must expose dataGapSummary')
  if (summary.summary?.blockedReasons?.includes('validation_evidence')) {
    assertNoTradeAllowed(summary, 'portfolio summary')
    assert.ok(['TRADE_BLOCKED', 'OBSERVE_ONLY', 'DATA_INSUFFICIENT'].includes(summary.capabilityState), 'validation failure must not look trade ready')
  }
  return summary
}

async function verifyPositionDetail() {
  const sample = await prisma.position.findFirst({
    where: {
      userId: 'default',
      status: 'open',
      asset: { type: { not: 'cash' } },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  if (!sample) return { skipped: true }

  const detail = await analysisService.getFivdRAnalysis('default', {
    positionId: sample.id,
    scope: 'position',
  }) as any
  assert.equal(detail.scope, 'position')
  assert.ok(Array.isArray(detail.dataGapSummary), 'position detail must expose dataGapSummary')
  if (detail.summary?.blockedReasons?.includes('validation_evidence')) {
    assertNoTradeAllowed(detail, 'position detail')
    assert.equal(detail.tradingDiscipline?.formalTradeActionAllowed, false, 'trading discipline must block formal action')
    assert.equal(detail.positionAdviceImpact?.validationGateMultiplier, 0, 'validation gate multiplier must be zero when blocked')
  }
  return { skipped: false, symbol: sample.asset.symbol }
}

async function verifyCandidateScoring() {
  const candidates = [
    { symbol: '601127', name: '赛力斯', strategyScore: 96, evidenceRefs: ['contract-test:strategy:601127'] },
    { symbol: '000001', name: '平安银行', strategyScore: 92, evidenceRefs: ['contract-test:strategy:000001'] },
    { symbol: '600000', name: '浦发银行', strategyScore: 88, evidenceRefs: ['contract-test:strategy:600000'] },
    { symbol: '300750', name: '宁德时代', strategyScore: 90, evidenceRefs: ['contract-test:strategy:300750'] },
    { symbol: '510300', name: '沪深300ETF', strategyScore: 82, evidenceRefs: ['contract-test:strategy:510300'] },
  ]
  const batch = await analysisService.scoreFivdRCandidates('default', {
    source: 'trade_gate_contract_test',
    strategyQuery: 'contract test high signal candidates',
    candidates,
  }) as any
  assert.equal(batch.schemaVersion, 'fivd.r.candidate_batch.v1')
  assert.ok(batch.candidates.length >= 1, 'candidate scoring must return analyzed candidates')
  for (const candidate of batch.candidates) {
    assert.equal(candidate.autoTradeAllowed, false, `${candidate.symbol} must keep autoTradeAllowed=false`)
    assert.ok(!candidate.allowedActions.includes('ADD'), `${candidate.symbol} must not allow ADD`)
    assert.ok(!candidate.allowedActions.includes('REDUCE'), `${candidate.symbol} must not allow REDUCE`)
    assert.ok(!candidate.allowedActions.includes('AUTO_TRADE'), `${candidate.symbol} must not allow AUTO_TRADE`)
    assert.ok(candidate.prohibitedActions.includes('AUTO_TRADE'), `${candidate.symbol} must prohibit AUTO_TRADE`)
    assert.ok(typeof candidate.signalScore === 'number', `${candidate.symbol} missing signalScore`)
    assert.ok(typeof candidate.researchScore === 'number', `${candidate.symbol} missing researchScore`)
    assert.ok(typeof candidate.evidenceAdjustedScore === 'number', `${candidate.symbol} missing evidenceAdjustedScore`)
    assert.ok(Array.isArray(candidate.dataGapSummary), `${candidate.symbol} missing dataGapSummary`)
    if (candidate.blockers.includes('validation_evidence')) {
      assert.ok(candidate.prohibitedActions.includes('ADD'), `${candidate.symbol} validation block must prohibit ADD`)
      assert.ok(candidate.prohibitedActions.includes('REDUCE'), `${candidate.symbol} validation block must prohibit REDUCE`)
    }
    if (candidate.blockers.includes('asset_identity_missing')) {
      assert.equal(candidate.disposition, 'needs_more_evidence', `${candidate.symbol} identity gap must require more evidence`)
      assert.equal(candidate.observeAllowed, false, `${candidate.symbol} identity gap must not enter observe`)
    }
  }
  return batch
}

async function verifyManualTradeDraft(summary: any) {
  const draft = await analysisService.createFivdRManualTradeDraft('default', {
    result: summary,
    requestedActions: [{ action: 'ADD', symbol: '601127', reason: 'contract test must be blocked' }],
  }) as any
  const payload = draft.result?.artifacts?.fivd_r_manual_trade_draft.json || draft.result || draft
  if (payload.blockedReasons?.includes('validation_evidence')) {
    assert.equal(payload.status, 'blocked', 'manual trade draft must be blocked by validation evidence')
    assert.equal(payload.manualTradeDraftAllowed, false, 'manual trade draft flag must remain false')
    assert.ok(payload.prohibitedActions.includes('ADD'), 'manual trade draft must prohibit ADD')
    assert.ok(payload.prohibitedActions.includes('REDUCE'), 'manual trade draft must prohibit REDUCE')
    assert.ok(payload.prohibitedActions.includes('AUTO_TRADE'), 'manual trade draft must prohibit AUTO_TRADE')
  }
  return payload
}

async function verifyLlmGuardrailSource() {
  const source = await readFile(new URL('../src/services/llm/llmService.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('不构成投资建议或交易依据'), 'LLM prompt must forbid trade decision output')
  assert.ok(source.includes('建议买入') && source.includes('建议加仓') && source.includes('建议减仓'), 'LLM guardrail must mention forbidden imperative examples')
  assert.ok(source.includes('可以下单') && source.includes('执行交易'), 'LLM guardrail must block executable trade wording')
}

async function verifyObserveArtifactsDoNotCreateTransactions(summary: any) {
  const before = await prisma.transaction.count()
  await analysisService.createFivdRResearchSnapshot('default', {
    result: summary,
    source: 'trade_gate_contract_test',
    note: 'contract test snapshot must remain research artifact',
  })
  await fivdRInterventionService.createReview({
    userId: 'default',
    runId: summary.runId || 'trade-gate-contract',
    positionId: null,
    symbol: null,
    decision: 'manual_watch',
    reason: 'contract test watch must remain observe-only',
    reviewer: 'contract_test',
    modelResultRef: summary.runId || 'trade-gate-contract',
    evidenceRefs: summary.evidenceGate?.evidenceRefs || [],
    override: {
      action: 'watchlist_add',
      source: 'trade_gate_contract_test',
    },
  })
  await alertService.createAlert({
    userId: 'default',
    type: 'risk',
    title: 'FIVD-R contract test risk alert',
    message: 'Risk alert must remain observe-only and must not create a transaction.',
    severity: 'info',
  })
  const after = await prisma.transaction.count()
  assert.equal(after, before, 'snapshot/watch/risk-alert must not create transactions')
}

async function main() {
  const summary = await verifyPortfolioSummary()
  const position = await verifyPositionDetail()
  const batch = await verifyCandidateScoring()
  const draft = await verifyManualTradeDraft(summary)
  await verifyLlmGuardrailSource()
  await verifyObserveArtifactsDoNotCreateTransactions(summary)

  console.log(JSON.stringify({
    ok: true,
    portfolioCapabilityState: summary.capabilityState,
    portfolioBlockedReasons: summary.summary?.blockedReasons || [],
    dataGapSummaryCount: summary.dataGapSummary?.length || 0,
    position,
    candidateCount: batch.candidates.length,
    candidateTop: batch.candidates.slice(0, 3).map((candidate: any) => ({
      symbol: candidate.symbol,
      signalScore: candidate.signalScore,
      researchScore: candidate.researchScore,
      evidenceAdjustedScore: candidate.evidenceAdjustedScore,
      disposition: candidate.disposition,
      prohibitedActions: candidate.prohibitedActions,
    })),
    manualTradeDraftStatus: draft.status,
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
