import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { dataGapRemediationService } from '../src/services/analysis/dataGapRemediationService.js'
import { operationService } from '../src/services/operation/operationService.js'
import type { DataGap } from '../src/services/analysis/dataGapTypes.js'

function gap(input: Partial<DataGap> & Pick<DataGap, 'gapId' | 'symbol'>): DataGap {
  return {
    gapId: input.gapId,
    symbol: input.symbol,
    assetType: input.assetType || 'stock',
    severity: 'blocking',
    category: input.category || 'market_data',
    blockedReason: input.blockedReason || 'market_data_missing',
    missingFields: ['market_bar_canonical', 'market_feature_daily'],
    requiredFor: ['research', 'observe'],
    userMessage: '行情缓存缺失。',
    developerMessage: 'market_data_missing',
    suggestedAction: '启动 symbol 级 market_bar_cache_preheat。',
    providerCandidates: ['market_bar_cache_preheat', 'sina'],
    evidenceRefs: [],
    ...input,
  }
}

async function main() {
  const plan = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: 'market-data-remediation-contract',
    gaps: [
      gap({ gapId: '601127:market_data_missing', symbol: '601127' }),
      gap({ gapId: '600000:provider_health', symbol: '600000', category: 'provider_health', blockedReason: 'provider_health_degraded' }),
    ],
  })
  const action = plan.actions.find((item) => item.actionId === 'refresh_market_data_cache')
  assert.equal(action?.status, 'executable')
  assert.equal(action?.operationType, 'market_bar_cache_preheat')
  assert.deepEqual(action?.symbols, ['601127', '600000'])
  assert.deepEqual(action?.operationInput?.symbols, ['601127', '600000'])

  const planned = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: 'market-data-remediation-contract',
    gaps: [gap({ gapId: 'missing-symbol:market_data_missing', symbol: '' })],
  })
  assert.equal(planned.actions.find((item) => item.actionId === 'refresh_market_data_cache')?.status, 'planned')

  const operation = await operationService.startMarketBarCachePreheatOperation({
    userId: 'default',
    symbols: ['601127', '600000'],
    limit: 2,
    days: 30,
    chunkSize: 2,
    concurrency: 2,
    forceRefresh: false,
    executionMode: 'queued',
    createdBy: 'verification',
    idempotencyKey: `verify-fivd-r-market-data-remediation-${Date.now()}`,
  })
  assert.equal(operation.status, 'queued')
  assert.equal(operation.input.symbols.length, 2)

  const worker = await operationService.runNextQueuedOperation({
    types: ['market_bar_cache_preheat' as any],
    workerId: 'fivd-r-market-data-remediation-verification',
  })
  assert.ok(worker.claimed)
  assert.equal(worker.operation?.id, operation.id)

  const completed = await operationService.getOperation(operation.id)
  assert.ok(['completed', 'partial'].includes(completed.status), `expected completed/partial, got ${completed.status}`)
  assert.ok(Array.isArray(completed.artifactRefs))
  const reportRef = completed.artifactRefs.find((ref: string) => ref.includes('market_bar_cache_preheat_report.json'))
  assert.ok(reportRef, 'market_bar_cache_preheat_report.json must exist')
  const result = completed.result || {}
  assert.equal(result.schemaVersion, 'fams.market_bar.cache_preheat_result.v1')
  assert.equal(result.requestedSymbols, 2, 'symbol-level preheat must not fall back to default universe')
  assert.ok(result.beforeCoverage)
  assert.ok(result.afterCoverage)
  assert.ok(result.featureReport)

  const artifact = await operationService.getArtifact(reportRef)
  assert.ok(artifact?.data)
  const report = artifact.data as Record<string, any>
  assert.equal(report.schemaVersion, 'fams.market_bar.cache_preheat_report.v1')
  assert.equal(report.universeSource, 'provided_symbols')
  assert.equal(report.requestedSymbols, 2)
  assert.ok(report.beforeCoverage)
  assert.ok(report.afterCoverage)
  assert.ok(report.featureReport)

  console.log(JSON.stringify({
    ok: true,
    planSummary: plan.summary,
    action: {
      actionId: action?.actionId,
      status: action?.status,
      operationType: action?.operationType,
      symbols: action?.symbols,
    },
    operationId: completed.id,
    operationStatus: completed.status,
    result: {
      requestedSymbols: result.requestedSymbols,
      attemptedSymbols: result.attemptedSymbols,
      successCount: result.successCount,
      warningCount: result.warningCount,
      failureCount: result.failureCount,
      afterSufficientSymbols: result.afterCoverage?.sufficientSymbols,
      afterInsufficientSymbols: result.afterCoverage?.insufficientSymbols,
      featureReport: result.featureReport,
    },
    artifactRefs: completed.artifactRefs,
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
