import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { strategyRoutes } from '../src/routes/strategy.js'
import { prisma } from '../src/db/prisma.js'

function history(start: number, days: number, drift: number) {
  const rows = []
  const startDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
  for (let index = 0; index < days; index += 1) {
    const close = start + (index * drift) + Math.sin(index / 11) * 0.3
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
      tradeabilityEvidenceRef: `market-history:api-fixture:${new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`,
    })
  }
  return rows
}

function researchCandidate(symbol: string, name: string) {
  return {
    symbol,
    name,
    listingAgeDays: 365 * 15,
    price: 10,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.65, evidenceRef: `api-fixture:${symbol}:dividend:2023` },
      { year: 2024, dividendPerShare: 0.72, evidenceRef: `api-fixture:${symbol}:dividend:2024` },
      { year: 2025, dividendPerShare: 0.82, evidenceRef: `api-fixture:${symbol}:dividend:2025` },
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
    history: history(12, 160, -0.004),
    evidenceRefs: [`api-fixture:${symbol}:annual-report`],
  }
}

function rollingCandidate(symbol: string, name: string, phase = 0) {
  return {
    ...researchCandidate(symbol, name),
    price: 10,
    history: history(10 + phase, 780, 0).map((bar, index) => {
      const close = 10 + phase + Math.sin(index / 18) * 0.72 + Math.sin(index / 7) * 0.18
      return {
        ...bar,
        open: close * 0.995,
        high: close * 1.015,
        low: close * 0.985,
        close,
        amount: close * 80_000_000,
        isTradable: true,
        tradabilityStatus: 'tradable' as const,
      }
    }),
    evidenceRefs: [`api-fixture:${symbol}:annual-report`, `api-fixture:${symbol}:3y-history`],
  }
}

async function main() {
  await prisma.dividendLowVolDaily.deleteMany({
    where: { userId: 'api-contract-test' },
  })
  const app = Fastify({ logger: false })
  await app.register(strategyRoutes, { prefix: '/api/v1/strategy' })
  await app.ready()

	  const scanResponse = await app.inject({
	    method: 'POST',
	    url: '/api/v1/strategy/dividend-low-vol/scan',
	    payload: {
	      candidates: [
	        {
	          ...researchCandidate('600000', '浦发银行'),
	          userId: 'api-contract-test',
	        },
	        {
	          ...researchCandidate('000001', '平安银行'),
	          userId: 'api-contract-test',
	        },
	      ],
	      userId: 'api-contract-test',
	    },
	  })
  assert.equal(scanResponse.statusCode, 200)
  const scan = scanResponse.json()
  assert.equal(scan.schemaVersion, 'dividend.low_vol.candidate_pool.v1')
  assert.equal(scan.strategyId, 'dividend_low_vol_leader_v1')
	  assert.equal(scan.total, 2)
  assert.deepEqual(scan.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(scan.candidates[0].evidenceRefs.length > 0)
  assert.ok(scan.candidates[0].dataVerification, 'scan candidate must expose data verification')
  assert.ok(scan.leaderAuditSummary, 'scan response must expose leader audit summary')
  assert.ok(Array.isArray(scan.candidates[0].dividend.dividendRiskFlags), 'scan candidate must expose dividend risk flags')
  assert.equal(typeof scan.candidates[0].dividend.dividendTrapFlag, 'boolean')
  assert.ok(scan.alertSummary, 'scan response must expose alert summary')
  assert.deepEqual(scan.candidates[0].tradingDiscipline.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
	  const persistedRows = await prisma.dividendLowVolDaily.count({ where: { userId: 'api-contract-test' } })
	  assert.equal(persistedRows, 2, 'scan endpoint must persist candidate daily rows')

  const persistedResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/candidates?userId=api-contract-test&symbols=600000&limit=1&persistedOnly=true',
  })
  assert.equal(persistedResponse.statusCode, 200)
  const persisted = persistedResponse.json()
  assert.equal(persisted.total, 1)
  assert.equal(persisted.source.persisted, true)
  assert.equal(persisted.candidates[0].identity.symbol, '600000')

	  const candidatesResponse = await app.inject({
	    method: 'GET',
	    url: '/api/v1/strategy/dividend-low-vol/candidates?symbols=600000,000001&limit=2',
	  })
	  assert.equal(candidatesResponse.statusCode, 200)
	  const candidates = candidatesResponse.json()
	  assert.ok(Array.isArray(candidates.candidates), 'candidate endpoint must return a candidate array even when default provider data is unavailable')
	  assert.equal(candidates.policy.prohibitedActions.includes('AUTO_TRADE'), true)

	  const testCandidatesResponse = await app.inject({
	    method: 'GET',
	    url: '/api/v1/strategy/dividend-low-vol/candidates?userId=api-contract-test&symbols=600000,000001&limit=2&persistedOnly=true',
	  })
	  assert.equal(testCandidatesResponse.statusCode, 200)
	  const testCandidates = testCandidatesResponse.json()
	  assert.equal(testCandidates.total, 2)
	  assert.ok(testCandidates.candidates.every((item: any) => item.evidenceRefs.length > 0))
	  assert.ok(testCandidates.candidates.every((item: any) => item.dataVerification), 'candidate pool must expose verification status')
	  assert.ok(testCandidates.candidates.every((item: any) => item.tradingDiscipline.prohibitedActions.includes('AUTO_TRADE')))

  const allAResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/candidates?scope=all&limit=8',
  })
  assert.equal(allAResponse.statusCode, 200)
  const allA = allAResponse.json()
  assert.equal(allA.universeSummary.schemaVersion, 'dividend.low_vol.universe_selection.v1')
  assert.ok(allA.universeSummary.universeTotal >= 5000, 'all-A universe must come from full canonical quote list')
  assert.equal(allA.total, 8)
  assert.ok(allA.candidates.every((item: any) => item.dataVerification), 'all-A candidates must expose verification')
  assert.ok(allA.candidates.some((item: any) => item.dataVerification.crossCheckedFields.length >= 3), 'all-A candidates should include cross-checked canonical/market/dividend fields')
  assert.ok(allA.rejectionSummary, 'all-A candidates must expose rejection summary')
  assert.ok(allA.leaderAuditSummary, 'all-A candidates must expose leader audit summary')
  assert.equal(typeof allA.leaderAuditSummary.canonicalIdentityCoveragePercent, 'number')
  assert.ok(allA.candidates.every((item: any) => item.positionContext), 'all-A candidates must expose portfolio linkage context')
  assert.ok(allA.candidates.every((item: any) => Array.isArray(item.dividend.dividendRiskFlags)), 'all-A candidates must expose dividend risk flags')
  assert.deepEqual(allA.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  const v2ResearchResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/v2/research-validation',
  })
  assert.equal(v2ResearchResponse.statusCode, 200)
  const v2Research = v2ResearchResponse.json()
  assert.equal(v2Research.strategyId, 'dividend_low_vol_leader_v2_research')
  assert.deepEqual(v2Research.validationDecision.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(v2Research.validationDecision.usableForTradingAdvice, false)
  assert.ok(['research_candidate_passed', 'missing', 'insufficient', 'research_candidate_failed'].includes(v2Research.status))
  if (v2Research.status !== 'missing') {
    assert.ok(v2Research.artifactRef.path.includes('dividend-low-vol-v2-research-validation'))
  }

  const manualDraftResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/manual-draft-readiness',
  })
  assert.equal(manualDraftResponse.statusCode, 200)
  const manualDraft = manualDraftResponse.json()
  assert.equal(manualDraft.schemaVersion, 'dividend.low_vol.manual_trade_draft_readiness.v1')
  assert.equal(manualDraft.formalTradeActionAllowed, false)
  assert.equal(manualDraft.autoTradeAllowed, false)
  assert.ok(manualDraft.prohibitedActions.includes('ADD'))
  assert.ok(manualDraft.prohibitedActions.includes('REDUCE'))
  assert.ok(manualDraft.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(['ready_for_manual_trade_draft', 'blocked', 'no_evidence'].includes(manualDraft.status))

  const manualAcceptanceResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/manual-acceptance-review',
  })
  assert.equal(manualAcceptanceResponse.statusCode, 200)
  const manualAcceptance = manualAcceptanceResponse.json()
  assert.ok(String(manualAcceptance.schemaVersion || '').includes('manual_acceptance_review'))
  assert.equal(manualAcceptance.decisionBoundary.formalTradingUnlocked, false)
  assert.equal(manualAcceptance.decisionBoundary.autoTradeUnlocked, false)
  assert.ok(manualAcceptance.decisionBoundary.prohibitedActions.includes('ADD'))
  assert.ok(manualAcceptance.decisionBoundary.prohibitedActions.includes('REDUCE'))
  assert.ok(manualAcceptance.decisionBoundary.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(Array.isArray(manualAcceptance.acceptanceChecklist))

	  const manualAcceptanceDecisionResponse = await app.inject({
	    method: 'POST',
	    url: '/api/v1/strategy/dividend-low-vol/manual-acceptance-review/decision',
    payload: {
      reviewer: 'api-contract-test',
      decision: 'accept_for_manual_draft_review',
	      reason: 'API contract test records manual acceptance without unlocking formal actions.',
	    },
	  })
	  assert.ok([200, 404].includes(manualAcceptanceDecisionResponse.statusCode))
	  const manualAcceptanceDecision = manualAcceptanceDecisionResponse.json()
	  assert.equal(manualAcceptanceDecision.schemaVersion, 'dividend.low_vol.manual_acceptance_decision.v1')
	  if (manualAcceptanceDecisionResponse.statusCode === 200) {
	    assert.ok(manualAcceptanceDecision.decisionId.startsWith('dividend-low-vol-manual-acceptance-decision-'))
	    assert.equal(manualAcceptanceDecision.decision, 'accept_for_manual_draft_review')
	    assert.equal(manualAcceptanceDecision.safetyAssertions.formalTradeActionAllowed, false)
	    assert.equal(manualAcceptanceDecision.safetyAssertions.autoTradeAllowed, false)
	  } else {
	    assert.equal(manualAcceptanceDecision.status, 'manual_acceptance_review_missing')
	    assert.equal(manualAcceptanceDecision.formalTradeActionAllowed, false)
	    assert.equal(manualAcceptanceDecision.autoTradeAllowed, false)
	  }
	  assert.ok(manualAcceptanceDecision.prohibitedActions.includes('ADD'))
	  assert.ok(manualAcceptanceDecision.prohibitedActions.includes('REDUCE'))
	  assert.ok(manualAcceptanceDecision.prohibitedActions.includes('AUTO_TRADE'))

	  if (manualAcceptanceDecisionResponse.statusCode === 200) {
	    const latestManualAcceptanceDecisionResponse = await app.inject({
	      method: 'GET',
	      url: '/api/v1/strategy/dividend-low-vol/manual-acceptance-decision',
	    })
	    assert.equal(latestManualAcceptanceDecisionResponse.statusCode, 200)
	    const latestManualAcceptanceDecision = latestManualAcceptanceDecisionResponse.json()
	    assert.equal(latestManualAcceptanceDecision.schemaVersion, 'dividend.low_vol.manual_acceptance_decision.v1')
	    assert.equal(latestManualAcceptanceDecision.decision, 'accept_for_manual_draft_review')
	    assert.ok(latestManualAcceptanceDecision.prohibitedActions.includes('ADD'))
	    assert.ok(latestManualAcceptanceDecision.prohibitedActions.includes('REDUCE'))
	    assert.ok(latestManualAcceptanceDecision.prohibitedActions.includes('AUTO_TRADE'))
	  }

  const tradeDraftResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/manual-trade-draft?topN=3',
  })
  assert.equal(tradeDraftResponse.statusCode, 200)
  const tradeDraft = tradeDraftResponse.json()
  assert.equal(tradeDraft.schemaVersion, 'dividend.low_vol.manual_trade_draft.v1')
  assert.equal(tradeDraft.formalTradeActionAllowed, false)
  assert.equal(tradeDraft.autoTradeAllowed, false)
  assert.ok(tradeDraft.prohibitedActions.includes('ADD'))
  assert.ok(tradeDraft.prohibitedActions.includes('REDUCE'))
  assert.ok(tradeDraft.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(tradeDraft.summary.requestedTopN <= 3)
  assert.ok(Array.isArray(tradeDraft.actions))
  assert.ok(tradeDraft.actions.every((action: any) => action.formalTargetWeightPercent === 0))
  assert.ok(tradeDraft.actions.every((action: any) => action.guardrails.some((item: string) => item.includes('不是正式'))))

  const persistedTradeDraftResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/manual-trade-draft',
    payload: {
      userId: 'default',
      topN: 3,
      requestedBy: 'api-contract-test',
    },
  })
  assert.equal(persistedTradeDraftResponse.statusCode, 200)
  const persistedTradeDraft = persistedTradeDraftResponse.json()
  assert.equal(persistedTradeDraft.schemaVersion, 'dividend.low_vol.manual_trade_draft.v1')
  assert.ok(persistedTradeDraft.draftId.startsWith('dividend-low-vol-draft-'))
  assert.ok(persistedTradeDraft.artifactRef.path.includes(persistedTradeDraft.draftId))
  assert.equal(persistedTradeDraft.formalTradeActionAllowed, false)
  assert.equal(persistedTradeDraft.autoTradeAllowed, false)
  assert.ok(persistedTradeDraft.prohibitedActions.includes('AUTO_TRADE'))

  const reviewTradeDraftResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/strategy/dividend-low-vol/manual-trade-draft/${encodeURIComponent(persistedTradeDraft.draftId)}/review`,
    payload: {
      reviewer: 'api-contract-test',
      decision: 'approve_for_watchlist',
      reason: 'API contract test approves this draft for watchlist review only.',
      selectedSymbols: persistedTradeDraft.actions.map((action: any) => action.symbol),
    },
  })
  assert.equal(reviewTradeDraftResponse.statusCode, 200)
  const reviewedTradeDraft = reviewTradeDraftResponse.json()
  assert.equal(reviewedTradeDraft.schemaVersion, 'dividend.low_vol.manual_trade_draft_review.v1')
  assert.ok(reviewedTradeDraft.reviewId.startsWith('dividend-low-vol-draft-review-'))
  assert.equal(reviewedTradeDraft.draftId, persistedTradeDraft.draftId)
  assert.equal(reviewedTradeDraft.decision, 'approve_for_watchlist')
  assert.ok(reviewedTradeDraft.artifactRef.path.includes(reviewedTradeDraft.reviewId))
  assert.equal(reviewedTradeDraft.formalTradeActionAllowed, false)
  assert.equal(reviewedTradeDraft.autoTradeAllowed, false)
  assert.ok(reviewedTradeDraft.prohibitedActions.includes('ADD'))
  assert.ok(reviewedTradeDraft.prohibitedActions.includes('REDUCE'))
  assert.ok(reviewedTradeDraft.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(reviewedTradeDraft.watchlistArtifactRef.path.includes('dividend-low-vol-watchlist-'))

  const manualWatchlistResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/manual-watchlist',
  })
  assert.equal(manualWatchlistResponse.statusCode, 200)
  const manualWatchlist = manualWatchlistResponse.json()
  assert.equal(manualWatchlist.schemaVersion, 'dividend.low_vol.manual_watchlist.v1')
  assert.equal(manualWatchlist.status, 'manual_review_watchlist')
  assert.equal(manualWatchlist.sourceReviewId, reviewedTradeDraft.reviewId)
  assert.equal(manualWatchlist.formalTradeActionAllowed, false)
  assert.equal(manualWatchlist.autoTradeAllowed, false)
  assert.ok(manualWatchlist.prohibitedActions.includes('ADD'))
  assert.ok(manualWatchlist.prohibitedActions.includes('REDUCE'))
  assert.ok(manualWatchlist.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(manualWatchlist.entries.length > 0)
  assert.ok(manualWatchlist.entries.every((entry: any) => entry.formalTargetWeightPercent === 0))

  const pretradeCheckResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check',
    payload: {
      requestedBy: 'api-contract-test',
    },
  })
  assert.equal(pretradeCheckResponse.statusCode, 200)
  const pretradeCheck = pretradeCheckResponse.json()
  assert.equal(pretradeCheck.schemaVersion, 'dividend.low_vol.manual_pretrade_check.v1')
  assert.equal(pretradeCheck.sourceWatchlistId, manualWatchlist.watchlistId)
  assert.equal(pretradeCheck.executionReady, false)
  assert.equal(pretradeCheck.formalTradeActionAllowed, false)
  assert.equal(pretradeCheck.autoTradeAllowed, false)
  assert.ok(pretradeCheck.prohibitedActions.includes('ADD'))
  assert.ok(pretradeCheck.prohibitedActions.includes('REDUCE'))
  assert.ok(pretradeCheck.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(pretradeCheck.entries.length > 0)
  assert.ok(pretradeCheck.entries.every((entry: any) => entry.formalTargetWeightPercent === 0))
  assert.ok(pretradeCheck.entries.every((entry: any) => entry.executionReady === false))
  assert.ok(pretradeCheck.entries.every((entry: any) => entry.checks.some((check: any) => check.id === 'formal_trade_action_locked' && check.status === 'blocked')))

  const pretradeReviewResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check/review',
    payload: {
      reviewer: 'api-contract-test',
      decision: 'continue_observe',
      reason: 'API contract test records observation-only pretrade review.',
    },
  })
  assert.equal(pretradeReviewResponse.statusCode, 200)
  const pretradeReview = pretradeReviewResponse.json()
  assert.equal(pretradeReview.schemaVersion, 'dividend.low_vol.manual_pretrade_review.v1')
  assert.ok(pretradeReview.reviewId.startsWith('dividend-low-vol-pretrade-review-'))
  assert.equal(pretradeReview.sourceCheckId, pretradeCheck.checkId)
  assert.equal(pretradeReview.decision, 'continue_observe')
  assert.equal(pretradeReview.executionReady, false)
  assert.equal(pretradeReview.formalTradeActionAllowed, false)
  assert.equal(pretradeReview.autoTradeAllowed, false)
  assert.ok(pretradeReview.prohibitedActions.includes('ADD'))
  assert.ok(pretradeReview.prohibitedActions.includes('REDUCE'))
  assert.ok(pretradeReview.prohibitedActions.includes('AUTO_TRADE'))

  const workflowAuditResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/manual-workflow-audit',
  })
  assert.equal(workflowAuditResponse.statusCode, 200)
  const workflowAudit = workflowAuditResponse.json()
  assert.equal(workflowAudit.schemaVersion, 'dividend.low_vol.manual_workflow_audit.v1')
  assert.equal(workflowAudit.status, 'complete_observation_workflow')
  assert.equal(workflowAudit.summary.executionReady, false)
  assert.equal(workflowAudit.summary.formalTradeActionAllowed, false)
  assert.equal(workflowAudit.summary.autoTradeAllowed, false)
  assert.ok(workflowAudit.summary.prohibitedActions.includes('ADD'))
  assert.ok(workflowAudit.summary.prohibitedActions.includes('REDUCE'))
  assert.ok(workflowAudit.summary.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(workflowAudit.stages.some((stage: any) => stage.id === 'manual_trade_draft' && stage.status !== 'missing'))
  assert.ok(workflowAudit.stages.some((stage: any) => stage.id === 'manual_pretrade_review' && stage.status === 'continue_observe'))
  assert.ok(workflowAudit.stages.some((stage: any) => stage.id === 'manual_acceptance_decision' && stage.status === 'accept_for_manual_draft_review'))
  assert.ok(workflowAudit.stages.every((stage: any) => stage.formalTradeActionAllowed === false && stage.autoTradeAllowed === false))

  const factsetResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/600000/factset',
  })
  assert.equal(factsetResponse.statusCode, 200)
  const factset = factsetResponse.json()
  assert.equal(factset.schemaVersion, 'dividend.low_vol.factset.v1')
  assert.equal(factset.strategyFamily, 'dividend_low_volatility')
  assert.ok(factset.evidenceRefs.length > 0)
  assert.deepEqual(factset.tradingDiscipline.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  const alertResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/alerts/check',
    payload: {
      candidates: [researchCandidate('600000', '浦发银行')],
    },
  })
  assert.equal(alertResponse.statusCode, 200)
  const alertCheck = alertResponse.json()
  assert.equal(alertCheck.schemaVersion, 'dividend.low_vol.alert_check.v1')
  assert.deepEqual(alertCheck.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(alertCheck.totalCandidates >= 1)

  const persistedAlertsResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/alerts?userId=api-contract-test&limit=20',
  })
  assert.equal(persistedAlertsResponse.statusCode, 200)
  const persistedAlerts = persistedAlertsResponse.json()
  assert.equal(persistedAlerts.schemaVersion, 'dividend.low_vol.persisted_alerts.v1')
  assert.deepEqual(persistedAlerts.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  const historyResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/strategy/dividend-low-vol/600000/history?userId=api-contract-test&limit=5',
  })
  assert.equal(historyResponse.statusCode, 200)
  const candidateHistory = historyResponse.json()
  assert.equal(candidateHistory.schemaVersion, 'dividend.low_vol.candidate_history.v1')
  assert.equal(candidateHistory.symbol, '600000')
  assert.ok(candidateHistory.history.length >= 1)

  const tradingZonesResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/trading-zones',
    payload: {
      candidates: [rollingCandidate('600000', '浦发银行'), rollingCandidate('601398', '工商银行', 0.3)],
      limit: 2,
    },
  })
  assert.equal(tradingZonesResponse.statusCode, 200)
  const tradingZones = tradingZonesResponse.json()
  assert.equal(tradingZones.schemaVersion, 'dividend.low_vol.trading_zone.v1')
  assert.deepEqual(tradingZones.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(tradingZones.notTradingAdvice, true)
  assert.ok(tradingZones.zones.length >= 1)
  assert.ok(tradingZones.zones.every((zone: any) => zone.strategies.length === 2))
  assert.ok(tradingZones.zones.every((zone: any) => zone.priceAudit?.freshnessStatus === 'fresh'))
  assert.ok(tradingZones.zones.every((zone: any) => zone.strategies.every((strategy: any) => strategy.priceAudit?.sanityStatus === 'aligned')))
  assert.ok(tradingZones.zones.every((zone: any) => zone.strategies.some((strategy: any) => strategy.buyZone.high !== null && strategy.sellZone.low !== null)))

  const wrongPriceGuardResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/trading-zones',
    payload: {
      candidates: [{
        ...researchCandidate('600887', '伊利股份'),
        price: 25.12,
        history: history(7.2, 160, 0),
        evidenceRefs: ['market-history:api-fixture:600887:wrong-anchor'],
      }],
      limit: 1,
    },
  })
  assert.equal(wrongPriceGuardResponse.statusCode, 200)
  const wrongPriceGuard = wrongPriceGuardResponse.json()
  const guardedStrategy = wrongPriceGuard.zones[0].strategies.find((strategy: any) => strategy.strategyId === 'dividend_low_vol_yield_ma_reversion_v1')
  assert.equal(guardedStrategy.status, 'insufficient')
  assert.equal(guardedStrategy.currentSignal, 'insufficient')
  assert.equal(guardedStrategy.priceAudit.sanityStatus, 'price_zone_mismatch')

  const yiliZoneResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/trading-zones',
    payload: {
      candidates: [{
        ...researchCandidate('600887', '伊利股份'),
        price: 25.12,
        history: history(27, 260, -0.006),
        evidenceRefs: ['market-history:api-fixture:600887:aligned'],
      }],
      limit: 1,
    },
  })
  assert.equal(yiliZoneResponse.statusCode, 200)
  const yiliZone = yiliZoneResponse.json()
  const yiliYieldMa = yiliZone.zones[0].strategies.find((strategy: any) => strategy.strategyId === 'dividend_low_vol_yield_ma_reversion_v1')
  assert.equal(yiliYieldMa.status, 'available')
  assert.ok(yiliYieldMa.buyZone.low > 20, '600887 buy zone must be around the 20s when price is 25.12')
  assert.ok(yiliYieldMa.buyZone.high > 20, '600887 buy zone must not fall back to stale 7.x pricing')
  assert.equal(yiliYieldMa.priceAudit.sanityStatus, 'aligned')

  const rollingBacktestResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/rolling-backtest',
    payload: {
      candidates: [
        rollingCandidate('600000', '浦发银行'),
        rollingCandidate('601398', '工商银行', 0.3),
        rollingCandidate('000001', '平安银行', -0.2),
      ],
      years: 3,
      minRequiredTradingDays: 600,
    },
  })
  assert.equal(rollingBacktestResponse.statusCode, 200)
  const rollingBacktest = rollingBacktestResponse.json()
  assert.equal(rollingBacktest.schemaVersion, 'dividend.low_vol.rolling_backtest.v1')
  assert.deepEqual(rollingBacktest.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(rollingBacktest.notTradingAdvice, true)
  assert.equal(rollingBacktest.window.requestedYears, 3)
  assert.equal(rollingBacktest.strategyResults.length, 2)
  assert.ok(rollingBacktest.strategyResults.every((strategy: any) => typeof strategy.metrics.winRatePercent === 'number'))
  assert.ok(rollingBacktest.strategyResults.every((strategy: any) => strategy.sample.tradeCount > 0))
  assert.ok(rollingBacktest.conclusion.bestStrategyId)

  const backtestResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/backtest',
    payload: {
      candidates: [researchCandidate('600000', '浦发银行'), researchCandidate('601398', '工商银行'), researchCandidate('000001', '平安银行')],
      initialCapital: 100000,
      dividendReinvestment: true,
    },
  })
  assert.equal(backtestResponse.statusCode, 200)
  const backtest = backtestResponse.json()
  assert.equal(backtest.schemaVersion, 'dividend.low_vol.backtest_result.v1')
  assert.equal(backtest.status, 'completed')
  assert.deepEqual(backtest.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(backtest.equityCurve.length >= 120)
  assert.ok(['candidate_ready_for_validation', 'candidate_ready_for_formal_validation', 'insufficient'].includes(backtest.validationEvidence.status))
  assert.ok(backtest.validationEvidence.diagnostics)
  assert.ok(backtest.benchmark, 'backtest must expose benchmark audit')
  assert.ok(backtest.tradeConstraintAudit, 'backtest must expose trade constraint audit')
  assert.equal(typeof backtest.metrics.estimatedCostDragPercent, 'number')
  assert.ok(Array.isArray(backtest.rebalanceEvents), 'backtest must expose rebalance events')

  const validationRetestResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/validation-retest',
    payload: {
      candidates: [researchCandidate('600000', '浦发银行'), researchCandidate('601398', '工商银行'), researchCandidate('000001', '平安银行')],
      initialCapital: 100000,
      dividendReinvestment: true,
    },
  })
  assert.equal(validationRetestResponse.statusCode, 200)
  const validationRetest = validationRetestResponse.json()
  assert.equal(validationRetest.schemaVersion, 'dividend.low_vol.validation_retest_artifact.v1')
  assert.equal(validationRetest.validationEvidenceMatrix.schemaVersion, 'dividend.low_vol.validation_evidence_matrix.v1')
  assert.deepEqual(validationRetest.validationDecision.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(validationRetest.validationDecision.usableForTradingAdvice, false)
  assert.ok(validationRetest.artifactRef.path.includes('dividend-low-vol-validation-retest'))

  const validationGapDiagnosticsResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/validation-gap-diagnostics',
    payload: {
      candidates: [researchCandidate('600000', '浦发银行'), researchCandidate('601398', '工商银行'), researchCandidate('000001', '平安银行')],
      initialCapital: 100000,
      dividendReinvestment: true,
    },
  })
  assert.equal(validationGapDiagnosticsResponse.statusCode, 200)
  const validationGapDiagnostics = validationGapDiagnosticsResponse.json()
  assert.equal(validationGapDiagnostics.schemaVersion, 'dividend.low_vol.validation_gap_diagnostics.v1')
  assert.equal(validationGapDiagnostics.notTradingAdvice, true)
  assert.ok(Array.isArray(validationGapDiagnostics.gaps))
  assert.equal(typeof validationGapDiagnostics.summary.blockingGapCount, 'number')
  assert.ok(validationGapDiagnostics.allowedActions.includes('RESEARCH'))
  assert.ok(validationGapDiagnostics.prohibitedActions.includes('ADD'))
  assert.ok(validationGapDiagnostics.prohibitedActions.includes('REDUCE'))
  assert.ok(validationGapDiagnostics.prohibitedActions.includes('AUTO_TRADE'))

  const fivdRResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/fivd-r/candidates',
    payload: {
      candidates: [researchCandidate('600000', '浦发银行')],
    },
  })
  assert.equal(fivdRResponse.statusCode, 200)
  const fivdR = fivdRResponse.json()
  assert.equal(fivdR.schemaVersion, 'dividend.low_vol.fivd_r_adapter.v1')
  assert.deepEqual(fivdR.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.deepEqual(fivdR.candidates[0].prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  const auditResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/strategy/dividend-low-vol/audit-package',
    payload: {
      userId: 'api-contract-test',
      limit: 20,
    },
  })
  assert.equal(auditResponse.statusCode, 200)
  const audit = auditResponse.json()
  assert.equal(audit.schemaVersion, 'dividend.low_vol.gpt_audit_package_ref.v1')
  assert.ok(audit.path.includes('dividend-low-vol-gpt-audit'))
  assert.deepEqual(audit.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  console.log(JSON.stringify({
    ok: true,
    scan: {
      total: scan.total,
      topDisposition: scan.candidates[0].disposition,
      prohibitedActions: scan.candidates[0].tradingDiscipline.prohibitedActions,
    },
    persisted: {
      rows: persistedRows,
      total: persisted.total,
      source: persisted.source,
    },
    candidates: {
      total: candidates.total,
      dispositions: candidates.candidates.map((item: any) => item.disposition),
      prohibitedActions: candidates.candidates.map((item: any) => item.tradingDiscipline.prohibitedActions),
    },
    allA: {
      universeTotal: allA.universeSummary.universeTotal,
      selectedCount: allA.universeSummary.selectedCount,
      total: allA.total,
      alertSummary: allA.alertSummary,
    },
    v2Research: {
      status: v2Research.status,
      v2ResearchCandidates: v2Research.v2ResearchCandidates,
      usableForTradingAdvice: v2Research.validationDecision.usableForTradingAdvice,
      prohibitedActions: v2Research.validationDecision.prohibitedActions,
    },
    manualDraft: {
      status: manualDraft.status,
      readyForManualTradeDraft: manualDraft.readyForManualTradeDraft,
      formalTradeActionAllowed: manualDraft.formalTradeActionAllowed,
      autoTradeAllowed: manualDraft.autoTradeAllowed,
      prohibitedActions: manualDraft.prohibitedActions,
    },
    tradeDraft: {
      status: tradeDraft.status,
      actions: tradeDraft.actions.length,
      prohibitedActions: tradeDraft.prohibitedActions,
      persistedDraftId: persistedTradeDraft.draftId,
      reviewId: reviewedTradeDraft.reviewId,
      watchlistId: manualWatchlist.watchlistId,
      pretradeCheckId: pretradeCheck.checkId,
      pretradeReviewId: pretradeReview.reviewId,
      workflowStatus: workflowAudit.status,
      artifactRef: persistedTradeDraft.artifactRef,
    },
    factset: {
      symbol: factset.identity.symbol,
      blockedReasons: factset.blockedReasons,
    },
    alertCheck: {
      totalAlerts: alertCheck.totalAlerts,
      prohibitedActions: alertCheck.policy.prohibitedActions,
    },
    persistedAlerts: {
      totalAlerts: persistedAlerts.totalAlerts,
    },
    history: {
      rows: candidateHistory.history.length,
    },
    backtest: {
      status: backtest.status,
      tradingDays: backtest.sample.tradingDays,
      validationStatus: backtest.validationEvidence.status,
      benchmark: backtest.benchmark.status,
      estimatedCostDragPercent: backtest.metrics.estimatedCostDragPercent,
    },
    validationRetest: {
      status: validationRetest.status,
      artifact: validationRetest.artifactRef.fileName,
      prohibitedActions: validationRetest.validationDecision.prohibitedActions,
    },
    validationGapDiagnostics: {
      status: validationGapDiagnostics.status,
      gaps: validationGapDiagnostics.summary.totalGaps,
      blockers: validationGapDiagnostics.summary.blockingGapCount,
    },
    fivdR: {
      candidates: fivdR.candidates.length,
      prohibitedActions: fivdR.candidates[0].prohibitedActions,
    },
    audit: {
      fileName: audit.fileName,
      candidateCount: audit.candidateCount,
    },
  }, null, 2))
  await app.close()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode || 0)
  })
