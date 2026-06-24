import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { dataGapRemediationService } from '../src/services/analysis/dataGapRemediationService.js'
import type { DataGap } from '../src/services/analysis/dataGapTypes.js'

function gap(input: Partial<DataGap> & Pick<DataGap, 'gapId' | 'category' | 'blockedReason'>): DataGap {
  return {
    assetType: 'stock',
    severity: 'degrading',
    symbol: '601127',
    missingFields: [input.blockedReason],
    requiredFor: ['research', 'observe'],
    userMessage: input.blockedReason,
    developerMessage: input.blockedReason,
    suggestedAction: input.blockedReason,
    providerCandidates: [],
    evidenceRefs: [],
    ...input,
  }
}

async function main() {
  const summary = await analysisService.getFivdRPortfolioSummary('default') as any
  assert.ok(Array.isArray(summary.dataGapSummary), 'latest summary must expose dataGapSummary')
  const latestPlan = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: summary.runId,
    gaps: summary.dataGapSummary,
  })
  assert.equal(latestPlan.schemaVersion, 'fivd.r.data_gap_remediation_plan.v1')
  assert.ok(latestPlan.summary.totalGaps >= 1, 'latest plan should diagnose current gaps')
  assert.ok(latestPlan.actions.some((action) => action.actionId === 'run_validation_retest_audit'), 'validation gap should map to retest audit')

  const fixturePlan = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: 'contract-fixture',
    gaps: [
      gap({ gapId: '601127:fundamental_factset_insufficient', category: 'fundamental', blockedReason: 'fundamental_factset_insufficient' }),
      gap({ gapId: '601127:valuation_metrics_missing', category: 'valuation', blockedReason: 'valuation_metrics_missing' }),
      gap({ gapId: '601127:financial_report_missing', category: 'financial_report', blockedReason: 'financial_report_missing' }),
      gap({ gapId: 'CANDIDATE:asset_identity_missing', category: 'asset_identity', blockedReason: 'asset_identity_missing', symbol: '601127', assetType: 'unknown' }),
      gap({ gapId: '601127:market_data_missing', category: 'market_data', blockedReason: 'market_data_missing', symbol: '601127', assetType: 'stock' }),
      gap({ gapId: 'FUND:fund_like_value_factset_missing', category: 'fund_factset', blockedReason: 'fund_like_value_factset_missing', symbol: '009725', assetType: 'fund' }),
      gap({ gapId: 'GOLD:gold_macro_value_factset_missing', category: 'gold_macro', blockedReason: 'gold_macro_value_factset_missing', symbol: 'GOLD', assetType: 'gold' }),
      gap({ gapId: 'VALIDATION:validation_evidence', category: 'validation_evidence', blockedReason: 'validation_evidence', symbol: 'VALIDATION_EVIDENCE', assetType: 'unknown' }),
    ],
  })
  const stockAction = fixturePlan.actions.find((action) => action.actionId === 'refresh_stock_factset')
  assert.equal(stockAction?.status, 'executable', 'stock gaps should be executable through batch_factset_refresh')
  assert.equal(stockAction?.operationType, 'batch_factset_refresh')
  assert.deepEqual(stockAction?.symbols, ['601127'])
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'refresh_fund_factset')?.status, 'unsupported')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'refresh_gold_macro_factset')?.status, 'unsupported')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'run_validation_retest_audit')?.status, 'executable')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'resolve_asset_identity')?.status, 'executable')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'resolve_asset_identity')?.operationType, 'fivd_r_asset_identity_resolution')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'refresh_market_data_cache')?.status, 'executable')
  assert.equal(fixturePlan.actions.find((action) => action.actionId === 'refresh_market_data_cache')?.operationType, 'market_bar_cache_preheat')

  const audit = await analysisService.createFivdRValidationRetestAudit('default', { candidateLimit: 5 }) as any
  assert.ok(audit.operationId, 'validation retest action must create an audit operation')
  assert.equal(audit.validationFailureTaxonomy?.summary?.tradeActionAllowed, false, 'validation taxonomy must not release trade action')

  console.log(JSON.stringify({
    ok: true,
    latestPlanSummary: latestPlan.summary,
    fixtureActions: fixturePlan.actions.map((action) => ({
      actionId: action.actionId,
      status: action.status,
      operationType: action.operationType || null,
      symbols: action.symbols,
    })),
    validationAuditOperationId: audit.operationId,
    tradeActionAllowed: audit.validationFailureTaxonomy?.summary?.tradeActionAllowed,
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
