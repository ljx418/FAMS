import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { dataGapRemediationService } from '../src/services/analysis/dataGapRemediationService.js'
import type { DataGap } from '../src/services/analysis/dataGapTypes.js'

function gap(input: Partial<DataGap> & Pick<DataGap, 'gapId' | 'symbol'>): DataGap {
  return {
    gapId: input.gapId,
    symbol: input.symbol,
    assetType: input.assetType || 'unknown',
    severity: 'blocking',
    category: 'asset_identity',
    blockedReason: 'asset_identity_missing',
    missingFields: ['assetId', 'assetType', 'market', 'exchange', 'name'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: '资产身份缺失。',
    developerMessage: 'asset_identity_missing',
    suggestedAction: '调用 Asset Identity Resolver，创建 research identity 或明确标注无法识别。',
    providerCandidates: ['local_asset_identity_resolver'],
    evidenceRefs: [],
    ...input,
  }
}

async function main() {
  const executablePlan = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: 'asset-identity-contract',
    gaps: [
      gap({ gapId: 'candidate:601127:asset_identity_missing', symbol: '601127' }),
      gap({ gapId: 'candidate:NOT_A_REAL_ASSET_123:asset_identity_missing', symbol: 'NOT_A_REAL_ASSET_123' }),
    ],
  })
  const identityAction = executablePlan.actions.find((action) => action.actionId === 'resolve_asset_identity')
  assert.equal(identityAction?.status, 'executable', 'symbol-level asset identity gaps must be executable')
  assert.equal(identityAction?.operationType, 'fivd_r_asset_identity_resolution')
  assert.deepEqual(identityAction?.symbols, ['601127', 'NOT_A_REAL_ASSET_123'])

  const plannedPlan = dataGapRemediationService.buildPlan({
    userId: 'default',
    sourceRunId: 'asset-identity-contract',
    gaps: [gap({ gapId: 'candidate:missing-symbol:asset_identity_missing', symbol: '' })],
  })
  assert.equal(plannedPlan.actions.find((action) => action.actionId === 'resolve_asset_identity')?.status, 'planned', 'asset identity gap without symbol must stay planned')

  const assetCountBefore = await prisma.asset.count()
  const report = await analysisService.createFivdRAssetIdentityResolutionReport('default', {
    symbols: ['601127', 'NOT_A_REAL_ASSET_123'],
    sourceRunId: 'asset-identity-contract',
  }) as any
  const assetCountAfter = await prisma.asset.count()

  assert.equal(assetCountAfter, assetCountBefore, 'asset identity remediation must not create official Asset records')
  assert.equal(report.schemaVersion, 'fivd.r.asset_identity_resolution_report.v1')
  assert.ok(report.operationId, 'asset identity report must be persisted as an Operation')
  assert.equal(report.summary.requestedSymbols, 2)
  assert.ok(report.summary.resolvedCount >= 1, 'at least the CN stock pattern sample should resolve')
  assert.ok(report.summary.unresolvedCount >= 1, 'invalid sample should remain unresolved')
  assert.ok(report.identities.some((identity: any) => identity.symbol === '601127' && identity.resolved === true), '601127 should resolve through local/pattern identity resolver')
  assert.ok(report.identities.some((identity: any) => identity.symbol === 'NOT_A_REAL_ASSET_123' && identity.resolved === false), 'invalid sample must stay unresolved')
  assert.deepEqual(report.allowedActions, ['RESEARCH', 'OBSERVE'])
  assert.ok(report.prohibitedActions.includes('ADD'))
  assert.ok(report.prohibitedActions.includes('REDUCE'))
  assert.ok(report.prohibitedActions.includes('AUTO_TRADE'))
  assert.ok(report.artifactRefs.some((ref: string) => ref.includes('asset_identity_resolution_report.json')))

  console.log(JSON.stringify({
    ok: true,
    executablePlanSummary: executablePlan.summary,
    operationId: report.operationId,
    requestedSymbols: report.requestedSymbols,
    summary: report.summary,
    prohibitedActions: report.prohibitedActions,
    assetCountStable: assetCountAfter === assetCountBefore,
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
